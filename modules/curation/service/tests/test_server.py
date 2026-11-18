import datetime
import uuid
from collections.abc import AsyncIterator

import grpc
import pytest
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_curation.config import Settings
from knowcel_curation.curation import Finding, Score, Scorer, Weights
from knowcel_curation.server import CurationServicer
from knowcel_platform.config import Problems
from knowcel_platform.grpc import UserInterceptor
from sqlalchemy.exc import OperationalError

from tests.fakes import NOW, FakeDocuments, FakeStore, doc

SEEN, HIDDEN, UNSCORED, OTHER = (doc(t) for t in ("Seen", "Hidden", "Unscored", "Other"))
USER = (("x-kb-user", "alice"),)
WEIGHTS = Weights(
    recency=1, usage=0, half_life_days=100, replacement_penalty=0.5, usage_saturation=10
)


@pytest.fixture
def store() -> FakeStore:
    store = FakeStore()
    for document, score in ((SEEN, 0.75), (HIDDEN, 0.25)):
        store.scores[document.id] = Score(document.id, score, NOW, NOW)
    store.findings = [
        Finding(uuid.uuid4(), "superseded", SEEN.id, OTHER.id, NOW),
        Finding(uuid.uuid4(), "duplicate", SEEN.id, HIDDEN.id, NOW),
        Finding(uuid.uuid4(), "conflict", OTHER.id, SEEN.id, NOW, resolution="ignore"),
    ]
    return store


@pytest.fixture
def documents() -> FakeDocuments:
    return FakeDocuments(SEEN, UNSCORED, OTHER)


@pytest.fixture
async def stub(
    store: FakeStore, documents: FakeDocuments
) -> AsyncIterator[curation_pb2_grpc.CurationServiceStub]:
    server = grpc.aio.server(interceptors=[UserInterceptor()])
    curation_pb2_grpc.add_CurationServiceServicer_to_server(
        CurationServicer(store, documents, Scorer(store, WEIGHTS)), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield curation_pb2_grpc.CurationServiceStub(channel)
    await server.stop(None)


async def test_get_document_score(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    response = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN.id)), metadata=USER
    )
    assert response.score.document_id == str(SEEN.id)
    assert response.score.score == 0.75
    assert response.score.updated_at.ToDatetime(datetime.UTC) == NOW


@pytest.mark.parametrize("document_id", [HIDDEN.id, UNSCORED.id, "not-an-id"])
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
        document_ids=[str(SEEN.id), str(HIDDEN.id), str(UNSCORED.id), str(SEEN.id)]
    )
    response = await stub.ScoreChunks(request, metadata=USER)
    assert {s.document_id: s.score for s in response.scores} == {str(SEEN.id): 0.75}
    # Only documents with a score are looked up.
    assert documents.asked == [{SEEN.id, HIDDEN.id}]


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


async def test_list_findings_shows_open_findings_of_readable_documents_worded_for_people(
    stub: curation_pb2_grpc.CurationServiceStub,
) -> None:
    response = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    # The duplicate is about a document the caller can't read; the conflict is resolved.
    (finding,) = response.findings
    assert finding.kind == curation_pb2.FINDING_KIND_SUPERSEDED
    assert (finding.document_id, finding.other_document_id) == (str(SEEN.id), str(OTHER.id))
    assert finding.summary == "Newer version of Other exists"
    assert (finding.document_title, finding.other_document_title) == ("Seen", "Other")
    options = {o.resolution: o.description for o in finding.resolutions}
    assert set(options) == {
        curation_pb2.RESOLUTION_KEEP,
        curation_pb2.RESOLUTION_REPLACE,
        curation_pb2.RESOLUTION_IGNORE,
    }
    assert "Other replaces Seen" in options[curation_pb2.RESOLUTION_REPLACE]


async def test_list_findings_is_limited(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = [Finding(uuid.uuid4(), "duplicate", SEEN.id, OTHER.id, NOW) for _ in range(3)]
    response = await stub.ListFindings(curation_pb2.ListFindingsRequest(page_size=2), metadata=USER)
    assert len(response.findings) == 2


async def _open_finding(store: FakeStore) -> Finding:
    return next(f for f in store.findings if f.kind == "superseded")


async def test_resolving_with_replace_keeps_the_penalty_and_keep_lifts_it(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    finding = await _open_finding(store)
    await Scorer(store, WEIGHTS).on_processed(SEEN.id, NOW)
    penalised = store.scores[SEEN.id].score
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=str(finding.id), resolution=curation_pb2.RESOLUTION_KEEP
        ),
        metadata=USER,
    )
    assert store.resolved_by[finding.id] == "alice"
    # Kept: the replacement no longer counts, so the score goes back up.
    assert store.scores[SEEN.id].score == pytest.approx(penalised * 2)
    listed = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    assert not listed.findings


async def test_resolving_with_replace_penalises_the_document(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    duplicate = Finding(uuid.uuid4(), "duplicate", SEEN.id, OTHER.id, NOW)
    store.findings = [duplicate]
    await Scorer(store, WEIGHTS).on_processed(SEEN.id, NOW)
    before = store.scores[SEEN.id].score
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=str(duplicate.id), resolution=curation_pb2.RESOLUTION_REPLACE
        ),
        metadata=USER,
    )
    assert store.scores[SEEN.id].score == pytest.approx(before * 0.5)


async def test_a_finding_resolves_once(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    finding = await _open_finding(store)
    request = curation_pb2.ResolveFindingRequest(
        finding_id=str(finding.id), resolution=curation_pb2.RESOLUTION_IGNORE
    )
    await stub.ResolveFinding(request, metadata=USER)
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ResolveFinding(request, metadata=USER)
    assert err.value.code() == grpc.StatusCode.FAILED_PRECONDITION


@pytest.mark.parametrize("which", ["hidden-document", "unknown", "malformed"])
async def test_a_finding_the_caller_cannot_see_is_not_found(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore, which: str
) -> None:
    hidden = next(f for f in store.findings if f.kind == "duplicate")
    ids = {"hidden-document": str(hidden.id), "unknown": str(uuid.uuid4()), "malformed": "x"}
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ResolveFinding(
            curation_pb2.ResolveFindingRequest(
                finding_id=ids[which], resolution=curation_pb2.RESOLUTION_IGNORE
            ),
            metadata=USER,
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND
    assert all(f.resolution != "ignore" or f.kind == "conflict" for f in store.findings)


async def test_a_resolution_is_required(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    finding = await _open_finding(store)
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ResolveFinding(
            curation_pb2.ResolveFindingRequest(finding_id=str(finding.id)), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_calls_need_a_user(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    calls = [
        stub.ListFindings(curation_pb2.ListFindingsRequest()),
        stub.GetDocumentScore(curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN.id))),
        stub.ScoreChunks(curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id)])),
        stub.ResolveFinding(
            curation_pb2.ResolveFindingRequest(
                finding_id=str(uuid.uuid4()), resolution=curation_pb2.RESOLUTION_KEEP
            )
        ),
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
            curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN.id)), metadata=USER
        ),
        stub.ScoreChunks(
            curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id)]), metadata=USER
        ),
    ]
    for call in calls:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await call
        assert err.value.code() == grpc.StatusCode.UNAVAILABLE


async def test_findings_are_withheld_while_documents_are_unavailable(
    stub: curation_pb2_grpc.CurationServiceStub, documents: FakeDocuments
) -> None:
    documents.down = True
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


async def test_scores_are_withheld_while_documents_are_unavailable(
    stub: curation_pb2_grpc.CurationServiceStub, documents: FakeDocuments
) -> None:
    documents.down = True
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ScoreChunks(
            curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id)]), metadata=USER
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
        curation_rescore_interval=0,
        curation_usage_saturation=0,
        llm_addr="nope",
        curation_conflict_threshold=0.9,
        curation_sample_chunks=0,
        curation_conflict_checks=-1,
    ).check(bad)
    assert len(bad.items) == 11


async def test_findings_come_in_pages_that_skip_unreadable_ones(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = [
        Finding(
            uuid.uuid4(),
            "duplicate",
            (HIDDEN if i % 2 else SEEN).id,
            OTHER.id,
            NOW + datetime.timedelta(minutes=i),
        )
        for i in range(10)
    ]
    seen: list[str] = []
    token = ""
    for _ in range(10):
        page = await stub.ListFindings(
            curation_pb2.ListFindingsRequest(page_size=2, page_token=token), metadata=USER
        )
        assert len(page.findings) <= 2
        seen += [f.id for f in page.findings]
        token = page.next_page_token
        if not token:
            break
    readable = [str(f.id) for f in store.findings if f.document_id == SEEN.id]
    assert sorted(seen) == sorted(readable)
    assert len(seen) == 5


async def test_a_page_token_must_be_ours(stub: curation_pb2_grpc.CurationServiceStub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListFindings(
            curation_pb2.ListFindingsRequest(page_token="garbage"), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_a_resolution_is_kept_when_scoring_fails(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    finding = await _open_finding(store)

    async def failing(document_id: uuid.UUID) -> int:
        raise OperationalError("select", {}, Exception("down"))

    store.count_replacements = failing
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=str(finding.id), resolution=curation_pb2.RESOLUTION_REPLACE
        ),
        metadata=USER,
    )
    resolved = await store.get_finding(finding.id)
    assert resolved is not None
    assert resolved.resolution == "replace"
