"""A chat call reaches the document module for the same caller, whose teams
the document module resolves."""

from typing import Any

import grpc
from knowcel.document.v1 import document_pb2, document_pb2_grpc
from knowcel.llm.v1 import llm_pb2
from knowcel_chat.peers import PeerRetriever
from knowcel_platform.grpc import (
    Principal,
    PrincipalResolver,
    Team,
    UserInterceptor,
    as_user,
    channel,
    current_principal,
)


class FakeLlm:
    async def Embed(self, _request: Any) -> llm_pb2.EmbedResponse:
        return llm_pb2.EmbedResponse(embeddings=[llm_pb2.Embedding(values=[0.1, 0.2])])


class RecordingDocuments(document_pb2_grpc.DocumentServiceServicer):
    def __init__(self) -> None:
        self.principals: list[Principal | None] = []

    async def SearchChunks(self, request: Any, context: Any) -> document_pb2.SearchChunksResponse:
        self.principals.append(current_principal())
        return document_pb2.SearchChunksResponse()


async def test_search_chunks_carries_the_caller_to_the_document_module() -> None:
    async def resolve(user: str) -> Principal:
        return Principal(user, teams=(Team("t1"),))

    documents = RecordingDocuments()
    server = grpc.aio.server(interceptors=[UserInterceptor(PrincipalResolver(resolve))])
    document_pb2_grpc.add_DocumentServiceServicer_to_server(documents, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        async with channel(f"127.0.0.1:{port}") as ch:
            retriever = PeerRetriever(
                document_pb2_grpc.DocumentServiceStub(ch),
                FakeLlm(),  # type: ignore[arg-type]
            )
            with as_user("alice"):
                await retriever.retrieve("q", 3, [])
            await retriever.retrieve("q", 3, [])  # a worker's call has no caller
    finally:
        await server.stop(None)
    assert documents.principals == [Principal("alice", teams=(Team("t1"),)), None]
