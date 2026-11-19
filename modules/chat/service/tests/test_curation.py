import logging
from types import SimpleNamespace
from typing import Any

import grpc
import pytest
from knowcel.curation.v1 import curation_pb2
from knowcel_chat.peers import PeerCuration, PeerReranker, PeerRetriever


def doc(i: int) -> str:
    return f"doc-{i}"


class FakeDocuments:
    """Returns one passage for each of `count` documents, in similarity order."""

    def __init__(self, count: int = 4) -> None:
        self.count = count
        self.requests: list[Any] = []

    async def SearchChunks(self, request: Any) -> Any:
        self.requests.append(request)
        results = [
            SimpleNamespace(
                chunk=SimpleNamespace(document_id=doc(i), index=i, text=f"passage {i}"),
                document_title=f"Doc {i}",
                score=0.9 - i / 1000,
                excerpt="",
                keyword_match=False,
            )
            for i in range(self.count)
        ]
        return SimpleNamespace(results=results[: request.limit])


class FakeLlm:
    def __init__(self, ratings: list[float] | None = None) -> None:
        self.ratings = ratings
        self.rated: list[list[str]] = []

    async def Embed(self, request: Any) -> Any:
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 0.0])])

    async def Rerank(self, request: Any) -> Any:
        self.rated.append(list(request.documents))
        return SimpleNamespace(scores=self.ratings or [0.5] * len(request.documents))


class FakeCuration:
    """Answers ScoreChunks from `scores`: document -> (score, excluded, replaced)."""

    def __init__(
        self, scores: dict[str, tuple[float, bool, bool]] | None = None, down: bool = False
    ) -> None:
        self.scores = scores or {}
        self.down = down
        self.requests: list[list[str]] = []
        self.timeouts: list[float | None] = []

    async def ScoreChunks(
        self,
        request: Any,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> Any:
        self.requests.append(list(request.document_ids))
        self.timeouts.append(timeout)
        if self.down:
            raise grpc.aio.AioRpcError(
                grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "down"
            )
        return curation_pb2.ScoreChunksResponse(
            scores=[
                curation_pb2.DocumentScore(
                    document_id=d, score=score, excluded=excluded, replaced=replaced
                )
                for d, (score, excluded, replaced) in self.scores.items()
                if d in request.document_ids
            ]
        )


def retriever(
    documents: FakeDocuments,
    curation: FakeCuration | None,
    weight: float = 0.5,
    llm: FakeLlm | None = None,
    reranker: bool = False,
    candidates: int = 0,
) -> PeerRetriever:
    llm = llm or FakeLlm()
    return PeerRetriever(
        documents,  # type: ignore[arg-type]
        llm,  # type: ignore[arg-type]
        reranker=PeerReranker(llm) if reranker else None,  # type: ignore[arg-type]
        candidates=candidates,
        curation=PeerCuration(curation) if curation else None,  # type: ignore[arg-type]
        curation_weight=weight,
    )


def indexes(found: list[Any]) -> list[int]:
    return [c.chunk_index for c in found]


async def test_passages_of_replaced_deprecated_and_archived_documents_are_left_out() -> None:
    curation = FakeCuration(
        {
            doc(0): (0.9, False, True),  # an older version
            doc(1): (0.2, True, False),  # deprecated or archived
            doc(2): (0.8, False, False),
        }
    )
    found = await retriever(FakeDocuments(), curation).retrieve("q", 4, [])
    # doc-3 has no score yet: it is new, and stays.
    assert indexes(found) == [2, 3]


async def test_a_lower_curation_score_ranks_a_passage_down() -> None:
    curation = FakeCuration({doc(0): (0.0, False, False), doc(1): (1.0, False, False)})
    found = await retriever(FakeDocuments(3), curation, weight=1).retrieve("q", 3, [])
    # doc-0 scores 0 and weighs fully: it goes last; the others keep their order.
    assert indexes(found) == [1, 2, 0]


async def test_the_weight_sets_how_far_a_score_ranks_down() -> None:
    # A score of 0 takes `weight` off a passage's rank factor: the first passage
    # at weight 0.6 ranks like position 1 / 0.4 = 2.5, behind the second (2) and
    # ahead of the third (3).
    curation = FakeCuration({doc(0): (0.0, False, False)})
    found = await retriever(FakeDocuments(4), curation, weight=0.6).retrieve("q", 4, [])
    assert indexes(found) == [1, 0, 2, 3]
    # At 0.4 it ranks like 1 / 0.6 = 1.7, still ahead of the second.
    found = await retriever(FakeDocuments(4), curation, weight=0.4).retrieve("q", 4, [])
    assert indexes(found) == [0, 1, 2, 3]
    # Without weight the scores change nothing but the exclusions.
    found = await retriever(FakeDocuments(4), curation, weight=0).retrieve("q", 4, [])
    assert indexes(found) == [0, 1, 2, 3]


async def test_the_similarity_score_of_a_citation_stays() -> None:
    curation = FakeCuration({doc(0): (0.0, False, False)})
    found = await retriever(FakeDocuments(2), curation, weight=1).retrieve("q", 2, [])
    assert found[-1].score == pytest.approx(0.9)


async def test_more_passages_are_fetched_to_make_up_for_those_left_out() -> None:
    documents = FakeDocuments(10)
    await retriever(documents, FakeCuration()).retrieve("q", 3, [])
    assert documents.requests[0].limit == 6
    plain = FakeDocuments(10)
    await retriever(plain, None).retrieve("q", 3, [])
    assert plain.requests[0].limit == 3


async def test_without_an_answer_from_curation_passages_keep_the_similarity_order(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        found = await retriever(FakeDocuments(), FakeCuration(down=True)).retrieve("q", 3, [])
    assert indexes(found) == [0, 1, 2]
    assert "curation unavailable" in caplog.text


async def test_curation_is_only_asked_about_the_documents_found_and_in_batches() -> None:
    documents = FakeDocuments(250)
    curation = FakeCuration()
    await retriever(documents, curation).retrieve("q", 125, [])
    assert [len(r) for r in curation.requests] == [100, 100, 50]
    empty = FakeCuration()
    await retriever(FakeDocuments(0), empty).retrieve("q", 3, [])
    assert empty.requests == []


async def test_a_left_out_document_never_reaches_the_reranker() -> None:
    llm = FakeLlm()
    curation = FakeCuration({doc(1): (0.5, True, False)})
    found = await retriever(
        FakeDocuments(), curation, llm=llm, reranker=True, candidates=4
    ).retrieve("q", 4, [])
    assert llm.rated == [["passage 0", "passage 2", "passage 3"]]
    assert indexes(found) == [0, 2, 3]


async def test_curation_gets_a_deadline_so_a_slow_answer_falls_back() -> None:
    curation = FakeCuration()
    await retriever(FakeDocuments(), curation).retrieve("q", 2, [])
    assert curation.timeouts == [3.0]
