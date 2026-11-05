"""The document and llm modules behind the ports of the answer use case. Their
gRPC statuses end here: callers only see PeerError."""

import contextlib
from collections.abc import AsyncIterator, Iterator

import grpc
from kb.chat.v1 import chat_pb2
from kb.document.v1 import document_pb2, document_pb2_grpc
from kb.llm.v1 import llm_pb2, llm_pb2_grpc

from .chat import Peer, PeerError, PeerUnavailableError, PromptMessage, PromptRole

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


class PeerRetriever:
    def __init__(
        self, documents: document_pb2_grpc.DocumentServiceStub, llm: llm_pb2_grpc.LlmServiceStub
    ) -> None:
        self._documents = documents
        self._llm = llm

    async def retrieve(self, query: str, limit: int) -> list[chat_pb2.Citation]:
        with _peer_errors(Peer.LLM):
            embedded = await self._llm.Embed(llm_pb2.EmbedRequest(inputs=[query]))
        with _peer_errors(Peer.DOCUMENT):
            result = await self._documents.SearchChunks(
                document_pb2.SearchChunksRequest(
                    embedding=embedded.embeddings[0].values, limit=limit
                )
            )
        return [
            chat_pb2.Citation(
                document_id=r.chunk.document_id,
                document_title=r.document_title,
                chunk_index=r.chunk.index,
                snippet=r.chunk.text,
                score=r.score,
            )
            for r in result.results
        ]


class PeerGenerator:
    def __init__(self, llm: llm_pb2_grpc.LlmServiceStub) -> None:
        self._llm = llm

    async def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncIterator[str]:
        messages = [llm_pb2.Message(role=_LLM_ROLES[m.role], content=m.content) for m in prompt]
        with _peer_errors(Peer.LLM):
            async for chunk in self._llm.Generate(
                llm_pb2.GenerateRequest(model=model, messages=messages)
            ):
                if chunk.delta:
                    yield chunk.delta
