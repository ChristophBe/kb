import uuid
from types import SimpleNamespace
from typing import Any

import grpc
import pytest
from knowcel_chat.chat import Peer, PeerUnavailableError
from knowcel_chat.peers import PeerReranker, PeerRetriever

TEAM = uuid.uuid4()


class FakeDocuments:
    """Returns four passages in similarity order and keeps the requests."""

    def __init__(self) -> None:
        self.requests: list[Any] = []

    async def SearchChunks(self, request: Any) -> Any:
        self.requests.append(request)

        def result(index: int, score: float) -> Any:
            chunk = SimpleNamespace(document_id="d", index=index, text=f"passage {index}")
            return SimpleNamespace(chunk=chunk, document_title="Doc", score=score)

        return SimpleNamespace(results=[result(i, 0.9 - i / 10) for i in range(4)])


class FakeLlm:
    def __init__(self, scores: list[float] | None = None, fail: bool = False) -> None:
        self.scores = scores or []
        self.fail = fail
        self.requests: list[Any] = []

    async def Embed(self, request: Any) -> Any:
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 0.0])])

    async def Rerank(self, request: Any) -> Any:
        self.requests.append(request)
        if self.fail:
            raise _Unavailable
        return SimpleNamespace(scores=self.scores)


class _Unavailable(grpc.aio.AioRpcError):
    def __init__(self) -> None:
        super().__init__(
            grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "down"
        )


def retriever(documents: FakeDocuments, llm: FakeLlm, candidates: int = 4) -> PeerRetriever:
    return PeerRetriever(
        documents,  # type: ignore[arg-type]
        llm,  # type: ignore[arg-type]
        reranker=PeerReranker(llm, "judge"),  # type: ignore[arg-type]
        candidates=candidates,
    )


async def test_the_best_rated_candidates_are_kept_in_rated_order() -> None:
    documents = FakeDocuments()
    llm = FakeLlm([0.1, 0.2, 0.9, 0.5])

    found = await retriever(documents, llm).retrieve("q", 2, [], [TEAM])

    assert [c.chunk_index for c in found] == [2, 3]
    # The similarity score stays, so the minimum score and the UI keep their meaning.
    assert found[0].score == pytest.approx(0.7)
    # More candidates than the limit are fetched, only from the caller's visible set.
    assert documents.requests[0].limit == 4
    assert list(documents.requests[0].team_ids) == [str(TEAM)]
    assert llm.requests[0].model == "judge"
    assert list(llm.requests[0].documents) == [f"passage {i}" for i in range(4)]


async def test_equally_rated_candidates_keep_the_similarity_order() -> None:
    found = await retriever(FakeDocuments(), FakeLlm([0.5] * 4)).retrieve("q", 3, [])

    assert [c.chunk_index for c in found] == [0, 1, 2]


async def test_a_failing_reranker_falls_back_to_the_similarity_order() -> None:
    found = await retriever(FakeDocuments(), FakeLlm(fail=True)).retrieve("q", 2, [])

    assert [c.chunk_index for c in found] == [0, 1]


async def test_a_reply_with_the_wrong_number_of_scores_is_a_failure() -> None:
    found = await retriever(FakeDocuments(), FakeLlm([1.0])).retrieve("q", 2, [])

    assert [c.chunk_index for c in found] == [0, 1]


async def test_without_a_reranker_only_the_limit_is_fetched() -> None:
    documents = FakeDocuments()
    llm = FakeLlm()

    found = await PeerRetriever(documents, llm).retrieve("q", 2, [])  # type: ignore[arg-type]

    assert documents.requests[0].limit == 2
    assert [c.chunk_index for c in found] == [0, 1]
    assert llm.requests == []


async def test_the_reranker_maps_an_unavailable_llm_to_a_peer_error() -> None:
    with pytest.raises(PeerUnavailableError) as raised:
        await PeerReranker(FakeLlm(fail=True)).rerank("q", ["a"])  # type: ignore[arg-type]
    assert raised.value.peer is Peer.LLM
