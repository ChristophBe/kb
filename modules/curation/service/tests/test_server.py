import datetime
import uuid
from collections.abc import AsyncIterator
from typing import Any

import grpc
import pytest
from google.protobuf.timestamp_pb2 import Timestamp
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_curation.config import Settings
from knowcel_curation.curation import DocInfo, Finding, Score, Scorer, Weights
from knowcel_curation.lifecycle import LifecycleService
from knowcel_curation.reports import ReportService
from knowcel_curation.server import CurationServicer
from knowcel_platform.config import Problems
from knowcel_platform.grpc import Principal, PrincipalResolver, Team, UserInterceptor
from sqlalchemy.exc import OperationalError

from tests.fakes import NOW, FakeDocuments, FakeStore, doc

SEEN, HIDDEN, UNSCORED, OTHER = (doc(t) for t in ("Seen", "Hidden", "Unscored", "Other"))
USER = (("x-kb-user", "alice"),)
WEIGHTS = Weights(
    recency=1,
    usage=0,
    half_life_days=100,
    replacement_penalty=0.5,
    usage_saturation=10,
    deprecated_factor=0.1,
    report_penalty=0.5,
    report_floor=0.25,
)


TEAM = str(uuid.uuid4())
OWNED = doc("Owned", owner="alice")
SHARED = doc("Shared", owner="alice", teams=[TEAM])
IAM_DOWN = False


async def resolve_principal(user: str) -> Principal:
    if IAM_DOWN:
        raise ConnectionError("iam unavailable")
    return {
        "team-admin": Principal(user, teams=(Team(TEAM, admin=True),)),
        "team-member": Principal(user, teams=(Team(TEAM, admin=False),)),
        "root": Principal(user, platform_admin=True),
    }.get(user, Principal(user))


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
    return FakeDocuments(SEEN, UNSCORED, OTHER, OWNED, SHARED)


@pytest.fixture
async def stub(
    store: FakeStore, documents: FakeDocuments
) -> AsyncIterator[curation_pb2_grpc.CurationServiceStub]:
    scorer = Scorer(store, WEIGHTS)
    servicer = CurationServicer(
        store, documents, scorer, LifecycleService(store, scorer), ReportService(store, scorer)
    )
    server = grpc.aio.server(interceptors=[UserInterceptor(PrincipalResolver(resolve_principal))])
    curation_pb2_grpc.add_CurationServiceServicer_to_server(servicer, server)
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
    assert documents.asked[0] == {SEEN.id, HIDDEN.id}


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
        stub.SetLifecycle(
            curation_pb2.SetLifecycleRequest(
                document_id=str(SEEN.id), state=curation_pb2.LIFECYCLE_STATE_DRAFT
            )
        ),
        stub.ListLifecycleHistory(
            curation_pb2.ListLifecycleHistoryRequest(document_id=str(SEEN.id))
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
        curation_report_penalty=2,
        curation_report_floor=-1,
        iam_addr="nope",
        curation_approved_boost=0.5,
        curation_deprecated_factor=2,
        curation_archived_factor=-1,
    ).check(bad)
    assert len(bad.items) == 17


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


def as_user(name: str) -> tuple[tuple[str, str], ...]:
    return (("x-kb-user", name),)


async def set_state(
    stub: curation_pb2_grpc.CurationServiceStub,
    document: DocInfo,
    user: str,
    state: Any = curation_pb2.LIFECYCLE_STATE_APPROVED,
    **fields: Any,
) -> None:
    await stub.SetLifecycle(
        curation_pb2.SetLifecycleRequest(document_id=str(document.id), state=state, **fields),
        metadata=as_user(user),
    )


@pytest.mark.parametrize(
    ("document", "user", "allowed"),
    [
        (OWNED, "alice", True),
        (OWNED, "bob", False),
        (OWNED, "team-admin", False),
        (OWNED, "root", True),
        (SHARED, "team-admin", True),
        (SHARED, "team-member", False),
        (SHARED, "bob", False),
    ],
)
async def test_who_may_change_the_lifecycle(
    stub: curation_pb2_grpc.CurationServiceStub,
    store: FakeStore,
    document: DocInfo,
    user: str,
    allowed: bool,
) -> None:
    if allowed:
        await set_state(stub, document, user)
        (change,) = await store.list_lifecycle_history(document.id)
        assert (change.lifecycle.state, change.lifecycle.owner, change.changed_by) == (
            "approved",
            user,
            user,
        )
    else:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await set_state(stub, document, user)
        assert err.value.code() == grpc.StatusCode.PERMISSION_DENIED
        assert not store.history


async def test_a_document_the_caller_cannot_read_is_not_found(
    stub: curation_pb2_grpc.CurationServiceStub,
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await set_state(stub, HIDDEN, "root")
    assert err.value.code() == grpc.StatusCode.NOT_FOUND
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.SetLifecycle(
            curation_pb2.SetLifecycleRequest(
                document_id="x", state=curation_pb2.LIFECYCLE_STATE_DRAFT
            ),
            metadata=USER,
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_only_the_owner_can_change_it_while_iam_is_down(
    stub: curation_pb2_grpc.CurationServiceStub, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tests.test_server.IAM_DOWN", True)
    await set_state(stub, SHARED, "alice")
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await set_state(stub, SHARED, "team-admin")
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


@pytest.mark.parametrize(
    "fields", [{"state": 0}, {"note": "x" * 1001}, {"owner": "x" * 201}], ids=str
)
async def test_a_change_needs_a_state_and_sensible_text(
    stub: curation_pb2_grpc.CurationServiceStub, fields: dict[str, Any]
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await set_state(stub, OWNED, "alice", **{"state": 1, **fields})
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_the_lifecycle_comes_with_the_score_and_deprecated_documents_are_excluded(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    review_by = Timestamp()
    review_by.FromDatetime(NOW + datetime.timedelta(days=30))
    await set_state(stub, SEEN, "alice", curation_pb2.LIFECYCLE_STATE_APPROVED, review_by=review_by)
    await store.save_score(UNSCORED.id, NOW, 0.5)
    await set_state(stub, UNSCORED, "root", curation_pb2.LIFECYCLE_STATE_DEPRECATED, note="old")
    response = await stub.ScoreChunks(
        curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id), str(UNSCORED.id)]),
        metadata=USER,
    )
    scores = {s.document_id: s for s in response.scores}
    assert scores[str(SEEN.id)].lifecycle.state == curation_pb2.LIFECYCLE_STATE_APPROVED
    assert scores[str(SEEN.id)].lifecycle.owner == "alice"
    assert scores[str(SEEN.id)].lifecycle.review_by.ToDatetime(datetime.UTC) == (
        NOW + datetime.timedelta(days=30)
    )
    assert not scores[str(SEEN.id)].excluded
    assert scores[str(UNSCORED.id)].excluded
    one = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(UNSCORED.id)), metadata=USER
    )
    assert one.score.excluded


@pytest.mark.parametrize(
    ("state", "excluded"),
    [
        (curation_pb2.LIFECYCLE_STATE_DRAFT, False),
        (curation_pb2.LIFECYCLE_STATE_IN_REVIEW, False),
        (curation_pb2.LIFECYCLE_STATE_APPROVED, False),
        (curation_pb2.LIFECYCLE_STATE_DEPRECATED, True),
        (curation_pb2.LIFECYCLE_STATE_ARCHIVED, True),
    ],
)
async def test_only_deprecated_and_archived_documents_are_excluded(
    stub: curation_pb2_grpc.CurationServiceStub, state: int, excluded: bool
) -> None:
    await set_state(stub, SEEN, "alice", state)
    response = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN.id)), metadata=USER
    )
    assert response.score.excluded is excluded


async def test_a_state_change_updates_the_score_at_once(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    await Scorer(store, WEIGHTS).on_processed(OWNED.id, datetime.datetime.now(datetime.UTC))
    before = store.scores[OWNED.id].score
    await set_state(stub, OWNED, "alice", curation_pb2.LIFECYCLE_STATE_DEPRECATED)
    assert store.scores[OWNED.id].score < before


async def test_the_history_lists_every_change_newest_first(
    stub: curation_pb2_grpc.CurationServiceStub,
) -> None:
    await set_state(stub, OWNED, "alice", curation_pb2.LIFECYCLE_STATE_DRAFT, note="first")
    await set_state(stub, OWNED, "root", curation_pb2.LIFECYCLE_STATE_APPROVED, note="checked")
    response = await stub.ListLifecycleHistory(
        curation_pb2.ListLifecycleHistoryRequest(document_id=str(OWNED.id)), metadata=USER
    )
    assert [(c.lifecycle.state, c.note, c.changed_by) for c in response.changes] == [
        (curation_pb2.LIFECYCLE_STATE_APPROVED, "checked", "root"),
        (curation_pb2.LIFECYCLE_STATE_DRAFT, "first", "alice"),
    ]
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListLifecycleHistory(
            curation_pb2.ListLifecycleHistoryRequest(document_id=str(HIDDEN.id)), metadata=USER
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_a_review_reminder_is_listed_and_cannot_be_replaced(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    reminder = Finding(uuid.uuid4(), "review_due", OWNED.id, OWNED.id, NOW)
    store.findings = [reminder]
    listed = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)
    (finding,) = listed.findings
    assert finding.kind == curation_pb2.FINDING_KIND_REVIEW_DUE
    assert finding.summary == "Review due for Owned"
    assert {o.resolution for o in finding.resolutions} == {
        curation_pb2.RESOLUTION_KEEP,
        curation_pb2.RESOLUTION_IGNORE,
    }
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ResolveFinding(
            curation_pb2.ResolveFindingRequest(
                finding_id=str(reminder.id), resolution=curation_pb2.RESOLUTION_REPLACE
            ),
            metadata=USER,
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=str(reminder.id), resolution=curation_pb2.RESOLUTION_KEEP
        ),
        metadata=USER,
    )


async def test_a_change_without_an_owner_keeps_the_one_responsible(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    await set_state(stub, SHARED, "alice", curation_pb2.LIFECYCLE_STATE_APPROVED, owner="carol")
    await set_state(stub, SHARED, "team-admin", curation_pb2.LIFECYCLE_STATE_DEPRECATED)
    (latest, first) = await store.list_lifecycle_history(SHARED.id)
    assert (first.lifecycle.owner, latest.lifecycle.owner) == ("carol", "carol")
    assert latest.changed_by == "team-admin"


async def test_a_review_date_out_of_range_is_invalid(
    stub: curation_pb2_grpc.CurationServiceStub,
) -> None:
    far = Timestamp(seconds=10**12)
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await set_state(stub, OWNED, "alice", review_by=far)
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_a_document_is_replaced_while_a_readable_document_replaces_it(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    for document in (SEEN, OTHER):
        await store.save_score(document.id, NOW, 0.5)
    # SEEN has an open version found (OTHER is newer and readable).
    request = curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id), str(OTHER.id)])
    scores = {s.document_id: s for s in (await stub.ScoreChunks(request, metadata=USER)).scores}
    assert scores[str(SEEN.id)].replaced
    assert not scores[str(OTHER.id)].replaced
    one = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(SEEN.id)), metadata=USER
    )
    assert one.score.replaced


async def test_a_replacement_the_caller_cannot_read_or_that_was_kept_does_not_count(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    kept = doc("Kept")
    secret = doc("Secret")
    for document in (SEEN, kept, secret):
        await store.save_score(document.id, NOW, 0.5)
    store.findings = [
        # Replaced by a document the caller can't read (HIDDEN is not readable).
        Finding(uuid.uuid4(), "superseded", SEEN.id, HIDDEN.id, NOW),
        # A version found, then kept by someone.
        Finding(uuid.uuid4(), "superseded", kept.id, OTHER.id, NOW, resolution="keep"),
    ]
    documents = FakeDocuments(SEEN, kept, OTHER)
    scorer = Scorer(store, WEIGHTS)
    servicer = CurationServicer(
        store, documents, scorer, LifecycleService(store, scorer), ReportService(store, scorer)
    )
    server = grpc.aio.server(interceptors=[UserInterceptor()])
    curation_pb2_grpc.add_CurationServiceServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        response = await curation_pb2_grpc.CurationServiceStub(channel).ScoreChunks(
            curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id), str(kept.id)]),
            metadata=USER,
        )
    await server.stop(None)
    assert [s.replaced for s in response.scores] == [False, False]


async def test_two_documents_replacing_each_other_are_both_kept(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    for document in (SEEN, OTHER):
        await store.save_score(document.id, NOW, 0.5)
    store.findings = [
        Finding(uuid.uuid4(), "superseded", SEEN.id, OTHER.id, NOW),
        Finding(uuid.uuid4(), "duplicate", OTHER.id, SEEN.id, NOW, resolution="replace"),
    ]
    response = await stub.ScoreChunks(
        curation_pb2.ScoreChunksRequest(document_ids=[str(SEEN.id), str(OTHER.id)]),
        metadata=USER,
    )
    assert [s.replaced for s in response.scores] == [False, False]


async def test_a_document_deprecated_before_it_was_scored_is_reported_excluded(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    assert OWNED.id not in store.scores
    await set_state(stub, OWNED, "alice", curation_pb2.LIFECYCLE_STATE_DEPRECATED)
    response = await stub.ScoreChunks(
        curation_pb2.ScoreChunksRequest(document_ids=[str(OWNED.id)]), metadata=USER
    )
    (score,) = response.scores
    assert score.excluded
    assert store.scores[OWNED.id].processed_at == OWNED.created_at


async def test_findings_can_be_limited_to_some_kinds(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = [
        Finding(uuid.uuid4(), "duplicate", SEEN.id, OTHER.id, NOW),
        Finding(uuid.uuid4(), "review_due", OWNED.id, OWNED.id, NOW),
        Finding(uuid.uuid4(), "conflict", SEEN.id, OTHER.id, NOW),
    ]
    only = await stub.ListFindings(
        curation_pb2.ListFindingsRequest(kinds=[curation_pb2.FINDING_KIND_REVIEW_DUE]),
        metadata=USER,
    )
    assert [f.kind for f in only.findings] == [curation_pb2.FINDING_KIND_REVIEW_DUE]
    two = await stub.ListFindings(
        curation_pb2.ListFindingsRequest(
            kinds=[curation_pb2.FINDING_KIND_DUPLICATE, curation_pb2.FINDING_KIND_CONFLICT]
        ),
        metadata=USER,
    )
    assert len(two.findings) == 2
    assert (
        len((await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=USER)).findings)
        == 3
    )


def report(
    stub: curation_pb2_grpc.CurationServiceStub, document: DocInfo, user: str, **fields: Any
):
    return stub.ReportDocument(
        curation_pb2.ReportDocumentRequest(
            document_id=str(document.id),
            reason=fields.pop("reason", curation_pb2.REPORT_REASON_WRONG),
            **fields,
        ),
        metadata=as_user(user),
    )


async def findings_of(stub: curation_pb2_grpc.CurationServiceStub, user: str):
    response = await stub.ListFindings(curation_pb2.ListFindingsRequest(), metadata=as_user(user))
    return [f for f in response.findings if f.kind == curation_pb2.FINDING_KIND_REPORTED]


async def test_reports_of_a_document_share_one_finding_the_owner_sees_with_all_of_them(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, OWNED, "bob", reason=curation_pb2.REPORT_REASON_OUTDATED, comment="Old")
    await report(stub, OWNED, "carol", comment="Wrong figure")
    assert len(store.findings) == 1
    (finding,) = await findings_of(stub, "alice")
    assert finding.summary == "Reported by 2 people"
    assert finding.report_count == 2
    assert {(r.reporter, r.comment) for r in finding.reports} == {
        ("bob", "Old"),
        ("carol", "Wrong figure"),
    }
    assert [o.resolution for o in finding.resolutions] == [
        curation_pb2.RESOLUTION_IGNORE,
        curation_pb2.RESOLUTION_DEPRECATE,
    ]
    assert (finding.document_id, finding.other_document_id) == (str(OWNED.id), str(OWNED.id))


async def test_a_second_report_of_a_user_replaces_their_first(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, OWNED, "bob", reason=curation_pb2.REPORT_REASON_WRONG, comment="a")
    await report(stub, OWNED, "bob", reason=curation_pb2.REPORT_REASON_OTHER, comment=" b ")
    (finding,) = await findings_of(stub, "alice")
    assert finding.report_count == 1
    (only,) = finding.reports
    assert (only.reason, only.comment) == (curation_pb2.REPORT_REASON_OTHER, "b")
    assert finding.summary == "Reported by one person"


async def test_a_reporter_sees_only_their_own_report_and_nobody_else_sees_it(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, OWNED, "bob", comment="mine")
    await report(stub, OWNED, "carol", comment="theirs")
    (bobs,) = await findings_of(stub, "bob")
    assert bobs.summary == "You reported Owned"
    assert [r.comment for r in bobs.reports] == ["mine"]
    assert bobs.report_count == 1
    assert not bobs.resolutions
    assert await findings_of(stub, "dave") == []
    # A team admin and a platform admin see them all.
    assert await findings_of(stub, "root") != []
    listed = await stub.ListReports(
        curation_pb2.ListReportsRequest(document_id=str(OWNED.id)), metadata=as_user("bob")
    )
    assert [r.comment for r in listed.reports] == ["mine"]
    everything = await stub.ListReports(
        curation_pb2.ListReportsRequest(document_id=str(OWNED.id)), metadata=as_user("alice")
    )
    assert len(everything.reports) == 2


async def test_team_admins_see_the_reports_of_a_document_shared_with_their_team(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, SHARED, "bob", comment="x")
    (finding,) = await findings_of(stub, "team-admin")
    assert finding.report_count == 1
    assert finding.resolutions
    assert await findings_of(stub, "team-member") == []


async def test_only_a_document_the_caller_can_read_can_be_reported_with_a_reason(
    stub: curation_pb2_grpc.CurationServiceStub,
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await report(stub, HIDDEN, "bob")
    assert err.value.code() == grpc.StatusCode.NOT_FOUND
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ReportDocument(
            curation_pb2.ReportDocumentRequest(document_id=str(OWNED.id)), metadata=as_user("bob")
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await report(stub, OWNED, "bob", comment="x" * 1001)
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ReportDocument(
            curation_pb2.ReportDocumentRequest(
                document_id=str(OWNED.id), reason=curation_pb2.REPORT_REASON_WRONG
            )
        )
    assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListReports(
            curation_pb2.ListReportsRequest(document_id=str(HIDDEN.id)), metadata=as_user("bob")
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_open_reports_lower_the_score_and_dismissing_them_restores_it(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await Scorer(store, WEIGHTS).on_processed(OWNED.id, datetime.datetime.now(datetime.UTC))
    before = store.scores[OWNED.id].score
    await report(stub, OWNED, "bob")
    assert store.scores[OWNED.id].score == pytest.approx(before * 0.5)
    await report(stub, OWNED, "carol")
    # Two reporters take it to the floor of 0.25; more don't go further.
    assert store.scores[OWNED.id].score == pytest.approx(before * 0.25)
    await report(stub, OWNED, "dave")
    assert store.scores[OWNED.id].score == pytest.approx(before * 0.25)
    (finding,) = await findings_of(stub, "alice")
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=finding.id, resolution=curation_pb2.RESOLUTION_IGNORE
        ),
        metadata=USER,
    )
    assert store.scores[OWNED.id].score == pytest.approx(before)
    assert await findings_of(stub, "alice") == []
    assert await findings_of(stub, "bob") == []


async def test_a_new_report_after_a_dismissal_makes_a_new_finding(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, OWNED, "bob")
    (finding,) = await findings_of(stub, "alice")
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=finding.id, resolution=curation_pb2.RESOLUTION_IGNORE
        ),
        metadata=USER,
    )
    await report(stub, OWNED, "bob", comment="again")
    (again,) = await findings_of(stub, "alice")
    assert again.id != finding.id
    assert [r.comment for r in again.reports] == ["again"]


async def test_deprecating_from_a_report_deprecates_the_document(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await Scorer(store, WEIGHTS).on_processed(OWNED.id, datetime.datetime.now(datetime.UTC))
    await report(stub, OWNED, "bob")
    (finding,) = await findings_of(stub, "alice")
    await stub.ResolveFinding(
        curation_pb2.ResolveFindingRequest(
            finding_id=finding.id, resolution=curation_pb2.RESOLUTION_DEPRECATE
        ),
        metadata=USER,
    )
    (current,) = (await store.get_lifecycles([OWNED.id])).values()
    assert current.state == "deprecated"
    history = await store.list_lifecycle_history(OWNED.id)
    assert (history[0].note, history[0].changed_by) == ("Deprecated after reports", "alice")
    scores = await stub.GetDocumentScore(
        curation_pb2.GetDocumentScoreRequest(document_id=str(OWNED.id)), metadata=USER
    )
    assert scores.score.excluded
    assert await findings_of(stub, "alice") == []


async def test_only_those_who_may_change_the_lifecycle_close_reports(
    stub: curation_pb2_grpc.CurationServiceStub, store: FakeStore
) -> None:
    store.findings = []
    await report(stub, OWNED, "bob")
    (finding,) = await findings_of(stub, "bob")
    for resolution in (curation_pb2.RESOLUTION_IGNORE, curation_pb2.RESOLUTION_DEPRECATE):
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await stub.ResolveFinding(
                curation_pb2.ResolveFindingRequest(finding_id=finding.id, resolution=resolution),
                metadata=as_user("bob"),
            )
        assert err.value.code() == grpc.StatusCode.PERMISSION_DENIED
    assert not store.history
    assert len(await findings_of(stub, "alice")) == 1
    # A report doesn't take keep or replace, and deprecating fits nothing else.
    for resolution in (curation_pb2.RESOLUTION_KEEP, curation_pb2.RESOLUTION_REPLACE):
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await stub.ResolveFinding(
                curation_pb2.ResolveFindingRequest(finding_id=finding.id, resolution=resolution),
                metadata=USER,
            )
        assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    other = Finding(uuid.uuid4(), "duplicate", SEEN.id, OTHER.id, NOW)
    store.findings.append(other)
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ResolveFinding(
            curation_pb2.ResolveFindingRequest(
                finding_id=str(other.id), resolution=curation_pb2.RESOLUTION_DEPRECATE
            ),
            metadata=USER,
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
