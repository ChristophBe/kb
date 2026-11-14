from collections.abc import AsyncIterator

import grpc
import prometheus_client
import pytest
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_llm.config import Settings
from kb_llm.providers import REGISTRY, build_provider, build_providers
from kb_llm.server import LlmServicer
from kb_platform.config import Problems
from kb_platform.grpc import field_violations


@pytest.fixture
async def stub() -> AsyncIterator[llm_pb2_grpc.LlmServiceStub]:
    settings = Settings(llm_provider="fake", embedding_dimensions=16)
    server = grpc.aio.server()
    llm_pb2_grpc.add_LlmServiceServicer_to_server(
        LlmServicer(build_providers(settings), settings), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield llm_pb2_grpc.LlmServiceStub(channel)
    await server.stop(None)


def test_unknown_provider_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown llm provider"):
        build_provider(Settings(llm_provider="nope"))
    assert {"ollama", "fake"} <= REGISTRY.keys()
    with pytest.raises(ValueError, match="unknown llm provider 'nope'"):
        build_providers(Settings(llm_provider="fake", embedding_provider="nope"))


def test_task_providers_fall_back_to_llm_provider() -> None:
    same = build_providers(Settings(llm_provider="fake"))
    assert not same.split
    assert same.chat.name == "fake"
    split = build_providers(Settings(llm_provider="fake", embedding_provider="ollama"))
    assert split.split
    assert (split.chat.name, split.embedding.name) == ("fake", "ollama")
    chat_only = build_providers(Settings(llm_provider="ollama", chat_provider="fake"))
    assert (chat_only.chat.name, chat_only.embedding.name) == ("fake", "ollama")


async def test_status_with_one_provider(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    status = await stub.GetProviderStatus(llm_pb2.GetProviderStatusRequest())
    assert (status.provider, status.healthy) == ("fake", True)
    assert status.chat == status.embedding
    assert status.chat.provider == "fake"
    assert status.detail == status.chat.detail


async def test_generate_streams_deltas_then_usage(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    request = llm_pb2.GenerateRequest(
        messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello there")]
    )
    responses = [r async for r in stub.Generate(request)]
    text = "".join(r.delta for r in responses)
    assert text.endswith("You said: hello there")
    assert responses[-1].done
    assert responses[-1].usage.output_tokens > 0


async def test_embed_is_deterministic_and_sized(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    resp = await stub.Embed(llm_pb2.EmbedRequest(inputs=["a", "b", "a"]))
    assert resp.dimensions == 16
    vectors = [list(e.values) for e in resp.embeddings]
    assert vectors[0] == vectors[2]
    assert vectors[0] != vectors[1]


async def test_generate_without_messages_is_rejected(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [r async for r in stub.Generate(llm_pb2.GenerateRequest())]
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(err.value)] == ["messages"]


async def test_generate_and_embed_record_metrics(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    labels = {"provider": "fake", "model": "fake-chat"}

    def sample(name: str, **extra: str) -> float:
        return prometheus_client.REGISTRY.get_sample_value(name, {**labels, **extra}) or 0

    before = sample("kb_llm_tokens_total", direction="output")
    request = llm_pb2.GenerateRequest(
        model="fake-chat",
        messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello there")],
    )
    responses = [r async for r in stub.Generate(request)]
    assert sample("kb_llm_tokens_total", direction="output") - before == (
        responses[-1].usage.output_tokens
    )
    assert sample("kb_llm_generation_duration_seconds_count") >= 1
    assert sample("kb_llm_generation_first_token_seconds_count") >= 1

    labels["model"] = "fake-embed"
    inputs_before = sample("kb_llm_embedding_inputs_total")
    await stub.Embed(llm_pb2.EmbedRequest(model="fake-embed", inputs=["a", "b"]))
    assert sample("kb_llm_embedding_inputs_total") - inputs_before == 2
    assert sample("kb_llm_embedding_duration_seconds_count") >= 1


def _problems(**settings: object) -> list[str]:
    found = Problems()
    Settings(**settings).check(found)  # type: ignore[arg-type]
    return found.items


def test_default_settings_are_valid() -> None:
    assert _problems() == []


@pytest.mark.parametrize(
    ("settings", "problem"),
    [
        (
            {"llm_provider": "openai"},
            "KB_LLM_PROVIDER: must be one of anthropic, fake, ollama, got 'openai'",
        ),
        (
            {"chat_provider": "nope"},
            "KB_CHAT_PROVIDER: must be one of anthropic, fake, ollama, got 'nope'",
        ),
        (
            {"embedding_provider": "nope"},
            "KB_EMBEDDING_PROVIDER: must be one of anthropic, fake, ollama, got 'nope'",
        ),
        (
            {"chat_provider": "anthropic"},
            "KB_ANTHROPIC_API_KEY: must be set for the anthropic provider",
        ),
        (
            {"ollama_url": "ollama:11434"},
            "KB_OLLAMA_URL: must be a URL with a host and scheme http or https, got 'ollama:11434'",
        ),
        ({"anthropic_max_tokens": 0}, "KB_ANTHROPIC_MAX_TOKENS: must be at least 1, got 0"),
        ({"provider_embed_timeout": 0}, "KB_PROVIDER_EMBED_TIMEOUT: must be positive, got 0.0"),
        ({"provider_attempts": 0}, "KB_PROVIDER_ATTEMPTS: must be at least 1, got 0"),
        ({"provider_retry_delay": -1}, "KB_PROVIDER_RETRY_DELAY: must be at least 0, got -1.0"),
        (
            {"provider_max_concurrency": 0},
            "KB_PROVIDER_MAX_CONCURRENCY: must be at least 1, got 0",
        ),
        ({"fake_token_delay": -1}, "KB_FAKE_TOKEN_DELAY: must be at least 0, got -1.0"),
        (
            {"embedding_dimensions": 0},
            "KB_EMBEDDING_DIMENSIONS: must be between 1 and 2000, got 0",
        ),
    ],
)
def test_each_setting_rule(settings: dict[str, object], problem: str) -> None:
    assert _problems(**settings) == [problem]


def test_fake_needs_no_ollama_url_and_problems_come_together() -> None:
    assert _problems(llm_provider="fake", ollama_url="") == []
    found = _problems(llm_provider="anthropic", provider_attempts=0, embedding_dimensions=0)
    assert [p.split(":")[0] for p in found] == [
        "KB_ANTHROPIC_API_KEY",
        "KB_PROVIDER_ATTEMPTS",
        "KB_EMBEDDING_DIMENSIONS",
    ]
