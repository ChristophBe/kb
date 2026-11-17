import json
from collections.abc import AsyncGenerator, AsyncIterator
from pathlib import Path

import grpc
import pytest
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc
from knowcel_llm.config import Settings
from knowcel_llm.providers import build_providers
from knowcel_llm.providers.base import Chunk, GenerationOptions, Message, ProviderError, Role
from knowcel_llm.providers.fake import FakeProvider
from knowcel_llm.providers.rerank import parse_ratings, rerank_with_chat
from knowcel_llm.server import LlmServicer


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


class Replying(FakeProvider):
    """Answers every generation with `reply` and keeps the prompt."""

    def __init__(self, reply: str) -> None:
        super().__init__(dimensions=4)
        self.reply = reply
        self.prompt: list[Message] = []

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
        self.prompt = messages
        yield Chunk(delta=self.reply)
        yield Chunk(done=True)


def test_ratings_are_read_per_passage_and_scaled_to_one() -> None:
    assert parse_ratings("[1]: 0\n[2]: 8\n3: 10", 3) == [0.0, 0.8, 1.0]


def test_passages_the_model_leaves_out_count_as_unrelated() -> None:
    assert parse_ratings("[2]: 5", 3) == [0.0, 0.5, 0.0]


def test_ratings_outside_the_range_are_clamped_or_ignored() -> None:
    assert parse_ratings("1: 15\n7: 3", 2) == [1.0, 0.0]


@pytest.mark.parametrize("reply", ["", "I cannot tell.", "9: 4"])
def test_a_reply_without_a_rating_is_an_error(reply: str) -> None:
    with pytest.raises(ProviderError, match="did not rate"):
        parse_ratings(reply, 2)


async def test_the_chat_model_is_asked_to_rate_the_numbered_passages() -> None:
    provider = Replying("[1]: 2\n[2]: 9")

    scores = await rerank_with_chat(provider, "m", "why?", ["first", "second"])

    assert scores == [0.2, 0.9]
    system, user = provider.prompt
    assert system.role is Role.SYSTEM
    assert user.content == "Question: why?\n\nPassages:\n[1] first\n\n[2] second"


async def test_rerank_scores_each_document_in_request_order(
    stub: llm_pb2_grpc.LlmServiceStub,
) -> None:
    response = await stub.Rerank(
        llm_pb2.RerankRequest(
            query="the red fox",
            documents=["a blue whale", "the quick red fox", "a fox"],
        )
    )

    assert response.model == "fake-chat"
    assert list(response.scores) == pytest.approx([0.0, 1.0, 1 / 3])


async def test_rerank_without_documents_returns_no_scores(
    stub: llm_pb2_grpc.LlmServiceStub,
) -> None:
    response = await stub.Rerank(llm_pb2.RerankRequest(query="q"))

    assert list(response.scores) == []


@pytest.mark.parametrize(
    "request_",
    [
        llm_pb2.RerankRequest(query=" ", documents=["a"]),
        llm_pb2.RerankRequest(query="q", documents=["a"] * 51),
    ],
)
async def test_rerank_rejects_an_empty_query_and_too_many_documents(
    stub: llm_pb2_grpc.LlmServiceStub, request_: llm_pb2.RerankRequest
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as raised:
        await stub.Rerank(request_)
    assert raised.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_the_evaluation_cases_name_a_relevant_passage() -> None:
    cases = json.loads((Path(__file__).parent / "fixtures" / "rerank_cases.json").read_text())
    assert len(cases) >= 10
    for case in cases:
        assert case["query"]
        assert 0 <= case["relevant"] < len(case["passages"])
