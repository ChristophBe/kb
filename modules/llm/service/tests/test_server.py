import grpc
import pytest
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_llm.config import Settings
from kb_llm.providers import REGISTRY, build_provider
from kb_llm.server import LlmServicer


@pytest.fixture
async def stub():
    settings = Settings(llm_provider="fake", embedding_dimensions=16)
    server = grpc.aio.server()
    llm_pb2_grpc.add_LlmServiceServicer_to_server(
        LlmServicer(build_provider(settings), settings), server
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


async def test_generate_streams_deltas_then_usage(stub) -> None:
    request = llm_pb2.GenerateRequest(
        messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello there")]
    )
    responses = [r async for r in stub.Generate(request)]
    text = "".join(r.delta for r in responses)
    assert text.endswith("You said: hello there")
    assert responses[-1].done
    assert responses[-1].usage.output_tokens > 0


async def test_embed_is_deterministic_and_sized(stub) -> None:
    resp = await stub.Embed(llm_pb2.EmbedRequest(inputs=["a", "b", "a"]))
    assert resp.dimensions == 16
    vectors = [list(e.values) for e in resp.embeddings]
    assert vectors[0] == vectors[2]
    assert vectors[0] != vectors[1]
