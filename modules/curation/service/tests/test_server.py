import datetime
import uuid
from collections.abc import AsyncIterator

import grpc
import pytest
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_curation.config import Settings
from knowcel_curation.curation import Finding, Score
from knowcel_curation.server import CurationServicer
from knowcel_platform.config import Problems
from knowcel_platform.grpc import UserInterceptor
from sqlalchemy.exc import OperationalError

NOW = datetime.datetime(2026, 11, 18, tzinfo=datetime.UTC)
DOCUMENT = uuid.uuid4()
OTHER = uuid.uuid4()


class FakeStore:
    def __init__(self) -> None:
        self.scores = {DOCUMENT: Score(DOCUMENT, 0.75, NOW)}
        self.findings = [Finding(uuid.uuid4(), "superseded", DOCUMENT, OTHER, NOW)]
        self.down = False

    async def get_score(self, document_id: uuid.UUID) -> Score | None:
        if self.down:
            raise OperationalError("select", {}, Exception("down"))
        return self.scores.get(document_id)

    async def list_findings(self) -> list[Finding]:
        if self.down:
            raise OperationalError("select", {}, Exception("down"))
        return self.findings


@pytest.fixture
def store() -> FakeStore:
    return FakeStore()


@pytest.fixture
async def stub(store: FakeStore) -> AsyncIterator[curation_pb2_grpc.CurationServiceStub]:
    server = grpc.aio.server(interceptors=[UserInterceptor()])
    curation_pb2_grpc.add_CurationServiceServicer_to_server(CurationServicer(store), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield curation_pb2_grpc.CurationServiceStub(channel)
    await server.stop(None)


USER = (("x-kb-user", "alice"),)


async def test_get_document_score(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    response = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(DOCUMENT)), metadata=USER
    )
    assert response.score.document_id == str(DOCUMENT)
    assert response.score.score == 0.75
    assert response.score.updated_at.ToDatetime(datetime.UTC) == NOW


@pytest.mark.parametrize("document_id", [str(uuid.uuid4()), "not-an-id"])
async def test_unknown_document_has_no_score(
    stub: curation_pb2_grpc.CurationServiceStub, document_id: str
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetDocumentScore(
            curation_pb2.GetDocumentScoreRequest(document_id=document_id), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_list_findings(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    response = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    (finding,) = response.findings
    assert finding.kind == curation_pb2.FINDING_KIND_SUPERSEDED
    assert (finding.document_id, finding.other_document_id) == (str(DOCUMENT), str(OTHER))


async def test_calls_need_a_user(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListFindings(curation_pb2.ListFindingsRequest())
    assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetDocumentScore(curation_pb2.GetDocumentScoreRequest(document_id=str(DOCUMENT)))
    assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED


async def test_database_outage_is_unavailable(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.down = True
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetDocumentScore(
            curation_pb2.GetDocumentScoreRequest(document_id=str(DOCUMENT)), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


def test_settings_are_checked() -> None:
    problems = Problems()
    Settings(database_url="mysql://x").check(problems)
    assert len(problems.items) == 1
    ok = Problems()
    Settings().check(ok)
    assert not ok.items
