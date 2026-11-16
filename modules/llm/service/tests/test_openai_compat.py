"""The OpenAI-compatible provider against a mocked HTTP transport."""

import json
from collections.abc import Callable

import httpx
import pytest
from knowcel_llm.config import Settings
from knowcel_llm.providers import REGISTRY, build_provider
from knowcel_llm.providers.base import (
    GenerationOptions,
    Message,
    ModelKind,
    ModelNotFoundError,
    NotSupportedError,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    Role,
)
from knowcel_llm.providers.openai_compat import OpenAICompatLimits, OpenAICompatProvider

Handler = Callable[[httpx.Request], httpx.Response]
HELLO = [Message(Role.USER, "hello")]


def sse(*events: dict[str, object] | str) -> httpx.Response:
    body = "".join(f"data: {e if isinstance(e, str) else json.dumps(e)}\n\n" for e in events)
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)


def delta(text: str) -> dict[str, object]:
    return {"choices": [{"index": 0, "delta": {"content": text}}]}


def provider(
    handler: Handler,
    requests: list[httpx.Request] | None = None,
    api_key: str | None = "sk-test",
    dimensions: int | None = None,
) -> OpenAICompatProvider:
    def record(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return handler(request)

    return OpenAICompatProvider(
        "http://llm.test/v1/",
        api_key,
        "gpt-test",
        "embed-test",
        dimensions,
        OpenAICompatLimits(retry_delay=0),
        httpx.MockTransport(record),
    )


def test_registered_and_built_from_settings() -> None:
    assert "openai" in REGISTRY
    built = build_provider(Settings(llm_provider="openai"))
    assert built.name == "openai"
    assert built.default_chat_model == "gpt-4o-mini"
    assert built.default_embedding_model == "text-embedding-3-small"


def test_local_server_needs_no_key() -> None:
    built = build_provider(
        Settings(llm_provider="openai", openai_url="http://localhost:1234/v1", openai_api_key=None)
    )
    assert built.name == "openai"


async def test_generate_streams_deltas_then_usage() -> None:
    requests: list[httpx.Request] = []
    p = provider(
        lambda _: sse(
            {"choices": [{"index": 0, "delta": {"role": "assistant"}}]},
            delta("Hel"),
            delta("lo"),
            {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 5}},
            "[DONE]",
        ),
        requests,
    )
    chunks = [
        c
        async for c in p.generate(
            "gpt-x",
            [Message(Role.SYSTEM, "Be brief."), *HELLO],
            GenerationOptions(temperature=0.2, max_tokens=50),
        )
    ]
    assert [c.delta for c in chunks if not c.done] == ["Hel", "lo"]
    assert chunks[-1].done
    assert (chunks[-1].input_tokens, chunks[-1].output_tokens) == (12, 5)

    (request,) = requests
    assert str(request.url) == "http://llm.test/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer sk-test"
    body = json.loads(request.content)
    assert body["model"] == "gpt-x"
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}
    assert body["temperature"] == 0.2
    assert body["max_tokens"] == 50
    assert body["messages"] == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "hello"},
    ]


async def test_generate_without_key_or_options_sends_neither() -> None:
    requests: list[httpx.Request] = []
    p = provider(lambda _: sse(delta("ok"), "[DONE]"), requests, api_key=None)
    chunks = [c async for c in p.generate("m", HELLO, GenerationOptions())]
    assert chunks[-1].done
    assert (chunks[-1].input_tokens, chunks[-1].output_tokens) == (0, 0)
    assert "authorization" not in requests[0].headers
    body = json.loads(requests[0].content)
    assert "temperature" not in body
    assert "max_tokens" not in body


async def test_generate_midstream_error_event() -> None:
    p = provider(lambda _: sse(delta("a"), {"error": {"message": "context too long"}}))
    with pytest.raises(ProviderError, match="context too long"):
        _ = [c async for c in p.generate("m", HELLO, GenerationOptions())]


async def test_embed_sends_dimensions_and_orders_by_index() -> None:
    requests: list[httpx.Request] = []
    p = provider(
        lambda _: httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [3.0, 4.0]},
                    {"index": 0, "embedding": [1.0, 2.0]},
                ]
            },
        ),
        requests,
        dimensions=2,
    )
    assert await p.embed("embed-test", ["a", "b"]) == [[1.0, 2.0], [3.0, 4.0]]
    body = json.loads(requests[0].content)
    assert body == {"model": "embed-test", "input": ["a", "b"], "dimensions": 2}
    assert str(requests[0].url) == "http://llm.test/v1/embeddings"


async def test_embed_omits_dimensions_by_default() -> None:
    requests: list[httpx.Request] = []
    p = provider(
        lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0]}]}), requests
    )
    await p.embed("m", ["a"])
    assert "dimensions" not in json.loads(requests[0].content)


async def test_list_models_classifies_embeddings() -> None:
    p = provider(
        lambda _: httpx.Response(
            200, json={"data": [{"id": "gpt-4o"}, {"id": "text-embedding-3-small"}]}
        )
    )
    models = await p.list_models()
    assert [(m.id, m.kind) for m in models] == [
        ("gpt-4o", ModelKind.CHAT),
        ("text-embedding-3-small", ModelKind.EMBEDDING),
    ]


async def test_pull_and_delete_are_not_supported() -> None:
    p = provider(lambda _: httpx.Response(500))
    with pytest.raises(NotSupportedError):
        _ = [x async for x in p.pull_model("m")]
    with pytest.raises(NotSupportedError):
        await p.delete_model("m")


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, ProviderAuthError),
        (403, ProviderAuthError),
        (404, ModelNotFoundError),
        (429, ProviderRateLimitedError),
        (503, ProviderUnavailableError),
        (400, ProviderError),
    ],
)
async def test_http_errors_are_translated(status: int, expected: type[ProviderError]) -> None:
    p = provider(lambda _: httpx.Response(status, json={"error": {"message": "x"}}))
    with pytest.raises(expected) as info:
        _ = [c async for c in p.generate("m", HELLO, GenerationOptions())]
    assert type(info.value) is expected
    with pytest.raises(expected):
        await p.embed("m", ["a"])


async def test_idempotent_calls_retry_transient_statuses() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"data": []})

    assert await provider(handler).list_models() == []
    assert calls == 3


async def test_rate_limit_is_not_retried() -> None:
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429)

    with pytest.raises(ProviderRateLimitedError):
        await provider(handler).embed("m", ["a"])
    assert calls == 1


async def test_status() -> None:
    ok = await provider(lambda _: httpx.Response(200, json={"data": []})).status()
    assert ok.healthy
    bad = await provider(lambda _: httpx.Response(401)).status()
    assert not bad.healthy
    assert "401" in bad.detail

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    down = await provider(refuse).status()
    assert not down.healthy
