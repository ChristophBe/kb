"""The document module behind the Documents port. Its gRPC statuses end here:
callers only see PeerError."""

import asyncio
import uuid
from collections.abc import Collection

import grpc
from knowcel.document.v1 import document_pb2, document_pb2_grpc

from .curation import PeerError, PeerUnavailableError

# Peer statuses that mean "try again later" rather than a bug.
_PEER_UNAVAILABLE = {grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED}


class PeerDocuments:
    def __init__(self, documents: document_pb2_grpc.DocumentServiceStub) -> None:
        self._documents = documents

    async def visible(self, document_ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
        # The call carries the user of the request, so the document module
        # decides what they can read.
        ids = list(document_ids)
        found = await asyncio.gather(*(self._can_read(i) for i in ids))
        return {i for i, ok in zip(ids, found, strict=True) if ok}

    async def _can_read(self, document_id: uuid.UUID) -> bool:
        try:
            await self._documents.GetDocument(document_pb2.GetDocumentRequest(id=str(document_id)))
        except grpc.aio.AioRpcError as err:
            if err.code() == grpc.StatusCode.NOT_FOUND:
                return False
            message = f"document {err.code()} {err.details()}"
            if err.code() in _PEER_UNAVAILABLE:
                raise PeerUnavailableError(message) from err
            raise PeerError(message) from err
        return True
