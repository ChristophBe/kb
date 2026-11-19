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

    def __init__(self, found: dict[int, tuple[str, bool]] | None = None) -> None:
        self.requests: list[Any] = []
        # index -> (excerpt, keyword_match)
        self.found = found or {}

    async def SearchChunks(self, request: Any) -> Any:
        self.requests.append(request)

        def result(index: int, score: float) -> Any:
            chunk = SimpleNamespace(document_id="d", index=index, text=f"passage {index}")
            excerpt, keyword = self.found.get(index, ("", False))
            return SimpleNamespace(
                chunk=chunk,
                document_title="Doc",
                score=score,
                excerpt=excerpt,
                keyword_match=keyword,
            )

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


async def test_the_question_is_sent_so_words_find_passages_too() -> None:
    documents = FakeDocuments()

    await retriever(documents, FakeLlm([0.5] * 4)).retrieve("find ID-42", 3, [])

    assert documents.requests[0].query == "find ID-42"


async def test_the_citation_shows_the_matched_fragment_or_else_the_chunk() -> None:
    documents = FakeDocuments({1: ("...ID-42...", True)})
    llm = FakeLlm([0.5] * 4)

    found = await retriever(documents, llm).retrieve("q", 3, [])

    assert [c.snippet for c in found] == ["passage 0", "...ID-42...", "passage 2"]
    # The reranker rates the whole chunks.
    assert list(llm.requests[0].documents) == [f"passage {i}" for i in range(4)]


async def test_a_keyword_match_is_kept_below_the_minimum_score() -> None:
    documents = FakeDocuments({3: ("ID-42", True), 2: ("not a match", False)})
    r = PeerRetriever(documents, FakeLlm(), min_score=0.75)  # type: ignore[arg-type]

    found = await r.retrieve("q", 4, [])

    # Scores 0.9, 0.8, 0.7, 0.6: the word match at 0.6 stays, the plain 0.7 goes.
    assert [c.chunk_index for c in found] == [0, 1, 3]


async def test_rating_is_reported_only_when_passages_are_rated() -> None:
    rated: list[str] = []

    await retriever(FakeDocuments(), FakeLlm()).retrieve(
        "q", 2, [], on_rating=lambda: rated.append("x")
    )
    await PeerRetriever(FakeDocuments(), FakeLlm()).retrieve(  # type: ignore[arg-type]
        "q", 2, [], on_rating=lambda: rated.append("y")
    )

    assert rated == ["x"]
