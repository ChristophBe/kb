"""The Anthropic provider against the real SDK with a mocked HTTP transport:
no network and no API key needed."""

import json
from collections.abc import AsyncIterator, Awaitable, Callable

import anthropic
import grpc
import httpx2
import pytest
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_llm.config import Settings
from kb_llm.providers import REGISTRY, Providers, build_provider, build_providers
from kb_llm.providers.anthropic import (
    MODELS,
    AnthropicLimits,
    AnthropicProvider,
    to_anthropic_messages,
    translate_error,
)
from kb_llm.providers.base import (
    GenerationOptions,
    Message,
    ModelNotFoundError,
    NotSupportedError,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    Role,
)
from kb_llm.providers.fake import FakeProvider
from kb_llm.server import LlmServicer
from pydantic import SecretStr

Handler = Callable[[httpx2.Request], httpx2.Response]
StubFactory = Callable[[Handler], Awaitable[llm_pb2_grpc.LlmServiceStub]]


def sse(*events: tuple[str, dict[str, object]]) -> bytes:
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()


def answer_stream(*deltas: str, input_tokens: int = 12, output_tokens: int = 5) -> bytes:
    return sse(
        (
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-sonnet-5-5",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {
                        "input_tokens": input_tokens,
                        "cache_read_input_tokens": 3,
                        "output_tokens": 1,
                    },
                },
            },
        ),
        (
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        ),
        ("ping", {"type": "ping"}),
        *(
            (
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": d},
                },
            )
            for d in deltas
        ),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": output_tokens},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    )


def streaming(body: bytes) -> httpx2.Response:
    return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)


def error(status: int, kind: str) -> httpx2.Response:
    return httpx2.Response(
        status, json={"type": "error", "error": {"type": kind, "message": "nope"}}
    )


def provider(handler: Handler, requests: list[httpx2.Request] | None = None) -> AnthropicProvider:
    def record(request: httpx2.Request) -> httpx2.Response:
        if requests is not None:
            requests.append(request)
        return handler(request)

    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
    )
    return AnthropicProvider("test-key", "claude-sonnet-5-5", 1024, AnthropicLimits(), client)


HELLO = [Message(Role.USER, "hello")]


def test_registered_and_missing_key_fails_at_startup() -> None:
    assert "anthropic" in REGISTRY
    with pytest.raises(ValueError, match="KB_ANTHROPIC_API_KEY is not set"):
        build_provider(Settings(llm_provider="anthropic", anthropic_api_key=None))
    built = build_provider(Settings(llm_provider="anthropic", anthropic_api_key=SecretStr("k")))
    assert built.name == "anthropic"
    assert built.default_chat_model == "claude-sonnet-5-5"


async def test_generate_streams_deltas_then_usage() -> None:
    requests: list[httpx2.Request] = []
    p = provider(lambda _: streaming(answer_stream("Hel", "lo", "!")), requests)
    chunks = [
        c
        async for c in p.generate(
            "claude-opus-5-5",
            [Message(Role.SYSTEM, "Be brief."), *HELLO],
            GenerationOptions(temperature=0.2, max_tokens=50),
        )
    ]
    assert [c.delta for c in chunks if not c.done] == ["Hel", "lo", "!"]
    assert chunks[-1].done
    assert (chunks[-1].input_tokens, chunks[-1].output_tokens) == (15, 5)

    (request,) = requests
    body = json.loads(request.content)
    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 50
    assert body["stream"] is True
    assert body["system"] == "Be brief."
    assert body["messages"] == [{"role": "user", "content": "hello"}]
    assert body["fallbacks"] == "default"
    assert "temperature" not in body
    assert "server-side-fallback-2026-07-01" in request.headers["anthropic-beta"]
    assert request.headers["authorization"] == "Bearer test-key"


async def test_generate_uses_default_max_tokens() -> None:
    requests: list[httpx2.Request] = []
    p = provider(lambda _: streaming(answer_stream("ok")), requests)
    _ = [c async for c in p.generate("claude-sonnet-5-5", HELLO, GenerationOptions())]
    assert json.loads(requests[0].content)["max_tokens"] == 1024
    assert "system" not in json.loads(requests[0].content)


def test_messages_map_to_system_and_alternating_turns() -> None:
    system, turns = to_anthropic_messages(
        [
            Message(Role.ASSISTANT, "Hi, ask me anything."),  # before any user turn
            Message(Role.SYSTEM, "Rule one."),
            Message(Role.USER, "first"),
            Message(Role.USER, "second"),
            Message(Role.ASSISTANT, ""),  # a stopped, empty answer
            Message(Role.SYSTEM, "Rule two."),
            Message(Role.ASSISTANT, "answer"),
            Message(Role.USER, "third"),
        ]
    )
    assert system == "Rule one.\n\nRule two."
    assert turns == [
        {"role": "user", "content": "first\n\nsecond"},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "third"},
    ]


async def test_generate_without_user_message_fails() -> None:
    p = provider(lambda _: streaming(answer_stream("x")))
    with pytest.raises(ProviderError, match="no user message"):
        _ = [c async for c in p.generate("m", [Message(Role.SYSTEM, "s")], GenerationOptions())]


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (error(401, "authentication_error"), ProviderAuthError),
        (error(403, "permission_error"), ProviderAuthError),
        (error(429, "rate_limit_error"), ProviderRateLimitedError),
        (error(529, "overloaded_error"), ProviderUnavailableError),
        (error(500, "api_error"), ProviderUnavailableError),
        (error(404, "not_found_error"), ModelNotFoundError),
        (error(400, "invalid_request_error"), ProviderError),
    ],
)
async def test_status_errors_are_translated(
    response: httpx2.Response, expected: type[ProviderError]
) -> None:
    p = provider(lambda _: response)
    with pytest.raises(expected) as raised:
        _ = [c async for c in p.generate("m", HELLO, GenerationOptions())]
    assert type(raised.value) is expected


async def test_error_event_mid_stream_is_translated() -> None:
    # The API reports a failure after the first tokens as an SSE error event on a 200.
    body = answer_stream("partial").split(b"event: content_block_stop")[0] + sse(
        ("error", {"type": "error", "error": {"type": "overloaded_error", "message": "busy"}})
    )
    chunks = provider(lambda _: streaming(body)).generate("m", HELLO, GenerationOptions())
    first = await anext(chunks)
    assert first.delta == "partial"
    with pytest.raises(ProviderUnavailableError):
        await anext(chunks)


def test_connection_errors_mean_unavailable() -> None:
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    assert isinstance(
        translate_error(anthropic.APIConnectionError(request=request)), ProviderUnavailableError
    )
    assert isinstance(translate_error(anthropic.APITimeoutError(request)), ProviderUnavailableError)


async def test_connect_failure_through_the_sdk_is_unavailable() -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    with pytest.raises(ProviderUnavailableError):
        _ = [c async for c in provider(refuse).generate("m", HELLO, GenerationOptions())]


async def test_embed_is_not_supported_and_models_are_chat_only() -> None:
    p = provider(lambda _: error(500, "api_error"))
    with pytest.raises(NotSupportedError, match="no embedding models"):
        await p.embed("any", ["text"])
    models = await p.list_models()
    assert [m.id for m in models] == list(MODELS)
    assert "claude-sonnet-5-5" in MODELS
    assert all(m.kind.value == "chat" for m in models)


async def test_status_reflects_the_api() -> None:
    ok = provider(
        lambda _: httpx2.Response(
            200, json={"data": [], "has_more": False, "first_id": None, "last_id": None}
        )
    )
    assert (await ok.status()).healthy
    denied = await provider(lambda _: error(401, "authentication_error")).status()
    assert not denied.healthy
    assert "authentication_error" in denied.detail


@pytest.fixture
async def stub() -> AsyncIterator[StubFactory]:
    servers: list[grpc.aio.Server] = []
    channels: list[grpc.aio.Channel] = []

    async def make(handler: Handler) -> llm_pb2_grpc.LlmServiceStub:
        # Claude chat with local embeddings, the pairing split providers exist for.
        settings = Settings(
            chat_provider="anthropic",
            embedding_provider="fake",
            anthropic_api_key=SecretStr("k"),
            embedding_dimensions=16,
        )
        providers = Providers(provider(handler), FakeProvider(settings.embedding_dimensions))
        server = grpc.aio.server()
        llm_pb2_grpc.add_LlmServiceServicer_to_server(LlmServicer(providers, settings), server)
        port = server.add_insecure_port("127.0.0.1:0")
        await server.start()
        servers.append(server)
        channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
        channels.append(channel)
        return llm_pb2_grpc.LlmServiceStub(channel)

    yield make
    for channel in channels:
        await channel.close()
    for server in servers:
        await server.stop(None)


async def test_grpc_generate_reports_usage(
    stub: StubFactory,
) -> None:
    client = await stub(lambda _: streaming(answer_stream("Hi", " there")))
    request = llm_pb2.GenerateRequest(
        messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello")]
    )
    responses = [r async for r in client.Generate(request)]
    assert "".join(r.delta for r in responses) == "Hi there"
    assert responses[-1].done
    assert responses[-1].model == "claude-sonnet-5-5"
    assert (responses[-1].usage.input_tokens, responses[-1].usage.output_tokens) == (15, 5)


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (error(401, "authentication_error"), grpc.StatusCode.FAILED_PRECONDITION),
        (error(429, "rate_limit_error"), grpc.StatusCode.RESOURCE_EXHAUSTED),
        (error(529, "overloaded_error"), grpc.StatusCode.UNAVAILABLE),
        (error(404, "not_found_error"), grpc.StatusCode.NOT_FOUND),
    ],
)
async def test_grpc_status_codes(
    stub: StubFactory,
    response: httpx2.Response,
    code: grpc.StatusCode,
) -> None:
    client = await stub(lambda _: response)
    request = llm_pb2.GenerateRequest(
        messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello")]
    )
    with pytest.raises(grpc.aio.AioRpcError) as raised:
        _ = [r async for r in client.Generate(request)]
    assert raised.value.code() == code


async def test_grpc_embeds_with_the_embedding_provider(
    stub: StubFactory,
) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return error(500, "api_error")

    client = await stub(handler)
    resp = await client.Embed(llm_pb2.EmbedRequest(inputs=["a"]))
    assert (resp.model, resp.dimensions, len(resp.embeddings)) == ("fake-embed", 16, 1)
    assert requests == []


async def test_grpc_status_and_models_report_both_providers(
    stub: StubFactory,
) -> None:
    client = await stub(lambda _: httpx2.Response(200, json={"data": [], "has_more": False}))
    status = await client.GetProviderStatus(llm_pb2.GetProviderStatusRequest())
    assert status.provider == "anthropic+fake"
    assert status.healthy
    assert (status.chat.provider, status.chat.healthy) == ("anthropic", True)
    assert (status.embedding.provider, status.embedding.healthy) == ("fake", True)
    assert (status.default_chat_model, status.default_embedding_model) == (
        "claude-sonnet-5-5",
        "fake-embed",
    )
    models = (await client.ListModels(llm_pb2.ListModelsRequest())).models
    assert {(m.provider, m.kind) for m in models} == {
        ("anthropic", llm_pb2.MODEL_KIND_CHAT),
        ("fake", llm_pb2.MODEL_KIND_EMBEDDING),
    }
    assert "fake-chat" not in {m.id for m in models}


async def test_grpc_status_is_unhealthy_when_the_chat_provider_is(
    stub: StubFactory,
) -> None:
    client = await stub(lambda _: error(401, "authentication_error"))
    status = await client.GetProviderStatus(llm_pb2.GetProviderStatusRequest())
    assert not status.healthy
    assert not status.chat.healthy
    assert status.embedding.healthy
    assert status.detail.startswith("chat: ")


def test_embeddings_from_anthropic_fail_at_startup() -> None:
    key = SecretStr("k")
    with pytest.raises(ValueError, match="no embedding models; set KB_EMBEDDING_PROVIDER"):
        build_providers(Settings(llm_provider="anthropic", anthropic_api_key=key))
    with pytest.raises(ValueError, match="no embedding models"):
        build_providers(Settings(embedding_provider="anthropic", anthropic_api_key=key))
    providers = build_providers(
        Settings(llm_provider="anthropic", embedding_provider="ollama", anthropic_api_key=key)
    )
    assert (providers.chat.name, providers.embedding.name) == ("anthropic", "ollama")
