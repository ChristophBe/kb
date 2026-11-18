import uuid

import grpc
import pytest
from knowcel.document.v1 import document_pb2
from knowcel_curation.curation import PeerError, PeerUnavailableError
from knowcel_curation.peers import PeerDocuments

READABLE, HIDDEN = uuid.uuid4(), uuid.uuid4()


def _error(code: grpc.StatusCode) -> grpc.aio.AioRpcError:
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "nope")


class FakeStub:
    def __init__(self, failure: grpc.StatusCode | None = None) -> None:
        self.failure = failure

    async def GetDocument(self, request: document_pb2.GetDocumentRequest):
        if self.failure:
            raise _error(self.failure)
        if request.id == str(HIDDEN):
            raise _error(grpc.StatusCode.NOT_FOUND)
        return document_pb2.GetDocumentResponse()


async def test_only_readable_documents_are_visible() -> None:
    documents = PeerDocuments(FakeStub())  # pyright: ignore[reportArgumentType]
    assert await documents.visible([READABLE, HIDDEN]) == {READABLE}


@pytest.mark.parametrize(
    ("code", "error"),
    [
        (grpc.StatusCode.UNAVAILABLE, PeerUnavailableError),
        (grpc.StatusCode.DEADLINE_EXCEEDED, PeerUnavailableError),
        (grpc.StatusCode.INTERNAL, PeerError),
    ],
)
async def test_peer_failures_become_peer_errors(
    code: grpc.StatusCode, error: type[PeerError]
) -> None:
    documents = PeerDocuments(FakeStub(code))  # pyright: ignore[reportArgumentType]
    with pytest.raises(error):
        await documents.visible([READABLE])
