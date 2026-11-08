from collections.abc import AsyncIterator

import grpc
import pytest
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_llm.config import Settings
from kb_llm.providers import REGISTRY, build_provider, build_providers
from kb_llm.server import LlmServicer
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
