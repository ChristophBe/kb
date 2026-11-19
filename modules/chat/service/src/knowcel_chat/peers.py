"""The document and llm modules behind the ports of the answer use case. Their
gRPC statuses end here: callers only see PeerError."""

import contextlib
import logging
import uuid
from collections.abc import AsyncGenerator, Collection, Iterator, Sequence
from dataclasses import dataclass
from typing import Any

import grpc
from knowcel.chat.v1 import chat_pb2
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel.document.v1 import document_pb2, document_pb2_grpc
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc

from .chat import Peer, PeerError, PeerUnavailableError, PromptMessage, PromptRole
from .manual import Manual, merge_sources

log = logging.getLogger("knowcel_chat")

# Peer statuses that mean "try again later" rather than a bug.
_PEER_UNAVAILABLE = {grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED}

_LLM_ROLES = {
    PromptRole.SYSTEM: llm_pb2.ROLE_SYSTEM,
    PromptRole.USER: llm_pb2.ROLE_USER,
    PromptRole.ASSISTANT: llm_pb2.ROLE_ASSISTANT,
}


@contextlib.contextmanager
def _peer_errors(peer: Peer) -> Iterator[None]:
    try:
        yield
    except grpc.aio.AioRpcError as err:
        message = f"{err.code()} {err.details()}"
        if err.code() in _PEER_UNAVAILABLE:
            raise PeerUnavailableError(peer, message) from err
        raise PeerError(peer, message) from err


class PeerEmbedder:
    def __init__(self, llm: llm_pb2_grpc.LlmServiceStub) -> None:
        self._llm = llm

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        with _peer_errors(Peer.LLM):
            embedded = await self._llm.Embed(llm_pb2.EmbedRequest(inputs=list(texts)))
        return [list(e.values) for e in embedded.embeddings]


class PeerReranker:
    """Rates passages against a question with the llm module's chat model."""

    def __init__(self, llm: llm_pb2_grpc.LlmServiceStub, model: str = "") -> None:
        self._llm = llm
        self._model = model

    async def rerank(self, query: str, texts: Sequence[str]) -> list[float]:
        with _peer_errors(Peer.LLM):
            ranked = await self._llm.Rerank(
                llm_pb2.RerankRequest(model=self._model, query=query, documents=list(texts))
            )
        if len(ranked.scores) != len(texts):
            raise PeerError(Peer.LLM, f"rerank returned {len(ranked.scores)} scores")
        return list(ranked.scores)


# Documents asked about in one ScoreChunks call, the most it takes.
_SCORE_BATCH = 100
# With curation, this many times the passages wanted are fetched, as some
# belong to documents that are left out.
_CURATION_OVERFETCH = 2


@dataclass(frozen=True)
class CurationScore:
    """What the curation module says about a document."""

    score: float
    # Deprecated or archived: not to be cited.
    excluded: bool
    # A newer version, or a confirmed replacement, the caller can read exists.
    replaced: bool


class PeerCuration:
    """The curation module's view of documents. It only refines retrieval, so
    a failure is logged and answered with None, and the caller carries on with
    the similarity order."""

    def __init__(self, curation: curation_pb2_grpc.CurationServiceStub) -> None:
        self._curation = curation

    async def scores(self, document_ids: Collection[str]) -> dict[str, CurationScore] | None:
        """The scores of those of the documents that have one and that the
        caller can see; None when curation can't be asked."""
        ids = sorted(set(document_ids))
        found: dict[str, CurationScore] = {}
        try:
            for start in range(0, len(ids), _SCORE_BATCH):
                batch = curation_pb2.ScoreChunksRequest(
                    document_ids=ids[start : start + _SCORE_BATCH]
                )
                response = await self._curation.ScoreChunks(batch)
                for s in response.scores:
                    found[s.document_id] = CurationScore(s.score, s.excluded, s.replaced)
        except grpc.aio.AioRpcError as err:
            log.warning(
                "curation unavailable, ranking by similarity alone: %s %s",
                err.code(),
                err.details(),
            )
            return None
        return found


class PeerRetriever:
    """Finds document passages and, with a manual, the manual sections that
    match the question; the question is embedded once for both. Passages
    scoring below `min_score` are unrelated to the question and left out, unless
    they contain its words. With `curation`, passages of documents that are
    replaced, deprecated or archived are left out, and a passage ranks down
    with its document's score (by up to `curation_weight`); without an answer
    from curation the order stays as found. With a `reranker`, `candidates`
    passages are fetched and the `limit` best by the reranker's rating are
    kept (passages rated alike keep the order before); if it fails, the best by
    the order before are."""

    def __init__(
        self,
        documents: document_pb2_grpc.DocumentServiceStub,
        llm: llm_pb2_grpc.LlmServiceStub,
        manual: Manual | None = None,
        min_score: float = 0.0,
        reranker: PeerReranker | None = None,
        candidates: int = 0,
        curation: PeerCuration | None = None,
        curation_weight: float = 0.0,
    ) -> None:
        self._documents = documents
        self._embedder = PeerEmbedder(llm)
        self._manual = manual
        self._min_score = min_score
        self._reranker = reranker
        self._candidates = candidates
        self._curation = curation
        self._curation_weight = curation_weight

    async def retrieve(
        self,
        query: str,
        limit: int,
        document_ids: Sequence[uuid.UUID],
        team_ids: Sequence[uuid.UUID] = (),
    ) -> list[chat_pb2.Citation]:
        (embedding,) = await self._embedder.embed([query])
        fetch = max(limit, self._candidates) if self._reranker else limit
        if self._curation:
            fetch = max(fetch, limit * _CURATION_OVERFETCH)
        with _peer_errors(Peer.DOCUMENT):
            result = await self._documents.SearchChunks(
                document_pb2.SearchChunksRequest(
                    embedding=embedding,
                    # With the words too, passages with an exact term (a name,
                    # an id) are found even when they are far from the question
                    # in meaning.
                    query=query,
                    # Visibility is filtered by the document module, so only
                    # passages the caller may read reach the reranker.
                    limit=fetch,
                    document_ids=[str(i) for i in document_ids],
                    team_ids=[str(i) for i in team_ids],
                )
            )
        # `min_score` is the similarity; a passage that has the question's words
        # stays even when it is semantically far, as exact terms are.
        found = [r for r in result.results if r.keyword_match or r.score >= self._min_score]
        found = await self._curate(found)
        documents = [
            chat_pb2.Citation(
                document_id=r.chunk.document_id,
                document_title=r.document_title,
                chunk_index=r.chunk.index,
                # The passage that matched, not the whole chunk, when words found it.
                snippet=r.excerpt or r.chunk.text,
                score=r.score,
            )
            for r in found
        ]
        if self._reranker:
            # Rated on the whole chunk, whatever fragment is shown.
            documents = await self._rerank(query, documents, [r.chunk.text for r in found])
        documents = documents[:limit]
        manual = self._manual.search(embedding) if self._manual else []
        return merge_sources(documents, manual)

    async def _curate(self, found: list[Any]) -> list[Any]:
        """Leaves out the passages of documents curation says not to cite and
        ranks the rest down by their document's score. The order of the
        document module is by rank, not by similarity, so a passage moves back
        by the factor its document's score takes off, not by a recomputed score."""
        if self._curation is None or not found:
            return found
        scores = await self._curation.scores({r.chunk.document_id for r in found})
        if scores is None:
            return found
        kept = [
            (position, r)
            for position, r in enumerate(found)
            if not ((s := scores.get(r.chunk.document_id)) and (s.excluded or s.replaced))
        ]

        def key(item: tuple[int, Any]) -> float:
            position, r = item
            s = scores.get(r.chunk.document_id)
            # A document without a score is new: it ranks as it was found.
            factor = 1 - self._curation_weight * (1 - s.score) if s else 1
            return (position + 1) / max(factor, 1e-6)

        return [r for _, r in sorted(kept, key=key)]

    async def _rerank(
        self, query: str, passages: list[chat_pb2.Citation], texts: list[str]
    ) -> list[chat_pb2.Citation]:
        if len(passages) < 2 or self._reranker is None:
            return passages
        try:
            scores = await self._reranker.rerank(query, texts)
        except PeerError as err:
            # Reranking only refines the order; the similarity order is still a good answer.
            log.warning("rerank failed, keeping the similarity order: %s", err)
            return passages
        order = sorted(range(len(passages)), key=lambda i: scores[i], reverse=True)
        return [passages[i] for i in order]


class PeerGenerator:
    def __init__(self, llm: llm_pb2_grpc.LlmServiceStub) -> None:
        self._llm = llm

    async def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncGenerator[str]:
        messages = [llm_pb2.Message(role=_LLM_ROLES[m.role], content=m.content) for m in prompt]
        with _peer_errors(Peer.LLM):
            call = self._llm.Generate(
                llm_pb2.GenerateRequest(model=model, messages=messages, caller_module="chat")
            )
            try:
                async for chunk in call:
                    if chunk.delta:
                        yield chunk.delta
            finally:
                # Closed early (the answer was stopped): the llm stops generating.
                # A no-op once the call has finished.
                call.cancel()
