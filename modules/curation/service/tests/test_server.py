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

from tests.fakes import NOW, FakeDocuments, FakeStore

SEEN, HIDDEN, UNSCORED = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
OTHER = uuid.uuid4()
USER = (("x-kb-user", "alice"),)


@pytest.fixture
def store() -> FakeStore:
    store = FakeStore()
    for document, score in ((SEEN, 0.75), (HIDDEN, 0.25)):
        store.scores[document] = Score(document, score, NOW, NOW)
    store.findings = [Finding(uuid.uuid4(), "superseded", SEEN, OTHER, NOW)]
    return store


@pytest.fixture
def documents() -> FakeDocuments:
    return FakeDocuments(SEEN, UNSCORED)


@pytest.fixture
async def stub(
    store: FakeStore, documents: FakeDocuments
) -> AsyncIterator[curation_pb2_grpc.CurationServiceStub]:
    server = grpc.aio.server(interceptors=[UserInterceptor()])
    curation_pb2_grpc.add_CurationServiceServicer_to_server(
        CurationServicer(store, documents), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield curation_pb2_grpc.CurationServiceStub(channel)
    await server.stop(None)


async def test_get_document_score(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    response = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN)), metadata=USER
    )
    assert response.score.document_id == str(SEEN)
    assert response.score.score == 0.75
    assert response.score.updated_at.ToDatetime(datetime.UTC) == NOW


@pytest.mark.parametrize("document_id", [HIDDEN, UNSCORED, "not-an-id"])
async def test_a_document_without_a_visible_score_is_not_found(
    stub: curation_pb2_grpc.CurationServiceStub, document_id: object
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetDocumentScore(
            curation_pb2.GetDocumentScoreRequest(document_id=str(document_id)), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_score_chunks_returns_the_scores_of_visible_documents(
    stub: curation_pb2_grpc.CurationServiceStub, documents: FakeDocuments
) -> None:
    request = curation_pb2.ScoreChunksRequest(
        document_ids=[str(SEEN), str(HIDDEN), str(UNSCORED), str(SEEN)]
    )
    response = await stub.ScoreChunks(request, metadata=USER)
    assert {s.document_id: s.score for s in response.scores} == {str(SEEN): 0.75}
    # Only documents with a score are looked up.
    assert documents.asked == [{SEEN, HIDDEN}]


async def test_score_chunks_without_documents_is_empty(
    stub: curation_pb2_grpc.CurationServiceStub, documents: FakeDocuments
) -> None:
    response = await stub.ScoreChunks(curation_pb2.ScoreChunksRequest(), metadata=USER)
    assert not response.scores
    assert not documents.asked


@pytest.mark.parametrize(
    "ids", [["nope"], [str(uuid.uuid4()) for _ in range(101)]], ids=["malformed", "too-many"]
)
async def test_score_chunks_rejects_bad_ids(
    stub: curation_pb2_grpc.CurationServiceStub, ids: list[str]
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ScoreChunks(curation_pb2.ScoreChunksRequest(document_ids=ids), metadata=USER)
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_list_findings(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    response = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    (finding,) = response.findings
    assert finding.kind == curation_pb2.FINDING_KIND_SUPERSEDED
    assert (finding.document_id, finding.other_document_id) == (str(SEEN), str(OTHER))


async def test_calls_need_a_user(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    calls = [
        stub.ListFindings(curation_pb2.ListFindingsRequest()),
        stub.GetDocumentScore(curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN))),
        stub.ScoreChunks(curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN)])),
    ]
    for call in calls:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await call
        assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED


async def test_database_outage_is_unavailable(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.down = True
    calls = [
        stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER),
        stub.GetDocumentScore(
            curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN)), metadata=USER
        ),
        stub.ScoreChunks(curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN)]), metadata=USER),
    ]
    for call in calls:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await call
        assert err.value.code() == grpc.StatusCode.UNAVAILABLE


async def test_scores_are_withheld_while_documents_are_unavailable(
    stub: curation_pb2_grpc.CurationServiceStub, documents: FakeDocuments
) -> None:
    documents.down = True
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ScoreChunks(
            curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN)]), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


def test_settings_are_checked() -> None:
    ok = Problems()
    Settings().check(ok)
    assert not ok.items
    bad = Problems()
    Settings(
        database_url="mysql://x",
        document_addr="nope",
        curation_recency_weight=0,
        curation_half_life_days=0,
        curation_replacement_penalty=2,
        curation_usage_saturation=0,
    ).check(bad)
    assert len(bad.items) == 6
