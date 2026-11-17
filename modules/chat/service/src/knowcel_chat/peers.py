"""The document and llm modules behind the ports of the answer use case. Their
gRPC statuses end here: callers only see PeerError."""

import contextlib
import logging
import uuid
from collections.abc import AsyncGenerator, Iterator, Sequence

import grpc
from knowcel.chat.v1 import chat_pb2
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


class PeerRetriever:
    """Finds document passages and, with a manual, the manual sections that
    match the question; the question is embedded once for both. Passages
    scoring below `min_score` are unrelated to the question and left out, unless
    they contain its words. With
    a `reranker`, `candidates` passages are fetched and the `limit` best by the
    reranker's rating are kept; if it fails, the best by similarity are."""

    def __init__(
        self,
        documents: document_pb2_grpc.DocumentServiceStub,
        llm: llm_pb2_grpc.LlmServiceStub,
        manual: Manual | None = None,
        min_score: float = 0.0,
        reranker: PeerReranker | None = None,
        candidates: int = 0,
    ) -> None:
        self._documents = documents
        self._embedder = PeerEmbedder(llm)
        self._manual = manual
        self._min_score = min_score
        self._reranker = reranker
        self._candidates = candidates

    async def retrieve(
        self,
        query: str,
        limit: int,
        document_ids: Sequence[uuid.UUID],
        team_ids: Sequence[uuid.UUID] = (),
    ) -> list[chat_pb2.Citation]:
        (embedding,) = await self._embedder.embed([query])
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
                    limit=max(limit, self._candidates) if self._reranker else limit,
                    document_ids=[str(i) for i in document_ids],
                    team_ids=[str(i) for i in team_ids],
                )
            )
        # `min_score` is the similarity; a passage that has the question's words
        # stays even when it is semantically far, as exact terms are.
        found = [r for r in result.results if r.keyword_match or r.score >= self._min_score]
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
