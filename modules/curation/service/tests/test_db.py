"""SqlCurationStore against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
import datetime
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from knowcel_curation.curation import REVIEW_DUE, FindingCursor, Lifecycle
from knowcel_curation.db import SqlCurationStore, findings, migrate
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration

# The image of deploy/infra.compose.yaml, as in modules/llm's tests.
IMAGE = "pgvector/pgvector:pg17"

DAY = datetime.timedelta(days=1)
T0 = datetime.datetime(2026, 11, 1, tzinfo=datetime.UTC)


@pytest.fixture(scope="module")
def database_url() -> Iterator[str]:
    with PostgresContainer(IMAGE, username="kb", password="kb", dbname="kb", driver=None) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+asyncpg://", 1)
        asyncio.run(migrate(url))
        yield url


@pytest.fixture
async def engine(database_url: str) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE curation.document_scores, curation.findings, curation.document_lifecycle"
            )
        )
    yield engine
    await engine.dispose()


async def test_save_score_inserts_then_updates(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    document = uuid.uuid4()
    assert await store.get_scores([document]) == []
    await store.save_score(document, T0, 1.0)
    await store.save_score(document, T0 + DAY, 0.5)
    (score,) = await store.get_scores([document, uuid.uuid4()])
    assert (score.document_id, score.score, score.processed_at) == (document, 0.5, T0 + DAY)


async def test_an_older_writer_does_not_overwrite_a_newer_score(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    document = uuid.uuid4()
    await store.save_score(document, T0 + DAY, 1.0)
    await store.save_score(document, T0, 0.4)
    (score,) = await store.get_scores([document])
    assert (score.score, score.processed_at) == (1.0, T0 + DAY)
    # The same time is a rescore and applies.
    await store.save_score(document, T0 + DAY, 0.7)
    (score,) = await store.get_scores([document])
    assert score.score == 0.7


async def test_list_scores_pages_by_document_id(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    ids = sorted(uuid.uuid4() for _ in range(5))
    for document in ids:
        await store.save_score(document, T0, 1.0)
    first = await store.list_scores(None, 3)
    rest = await store.list_scores(first[-1].document_id, 3)
    assert [s.document_id for s in first + rest] == ids


async def test_count_replacements_counts_superseded_findings_of_the_older_document(
    engine: AsyncEngine,
) -> None:
    store = SqlCurationStore(engine)
    older, newer, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as conn:
        for kind, document, against in (
            ("superseded", older, newer),
            ("superseded", older, other),
            ("duplicate", older, other),
            ("superseded", newer, older),
        ):
            await conn.execute(
                insert(findings).values(
                    id=uuid.uuid4(), kind=kind, document_id=document, other_document_id=against
                )
            )
    assert await store.count_replacements(older) == 2
    assert await store.count_replacements(newer) == 1
    assert await store.count_replacements(other) == 0


async def test_list_open_findings_newest_first_without_resolved_ones(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    a, b = uuid.uuid4(), uuid.uuid4()
    old, new, done = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as conn:
        for id_, kind, created, resolution in (
            (old, "duplicate", T0, None),
            (new, "superseded", T0 + DAY, None),
            (done, "conflict", T0 + 2 * DAY, "ignore"),
        ):
            await conn.execute(
                insert(findings).values(
                    id=id_,
                    kind=kind,
                    document_id=a,
                    other_document_id=b,
                    created_at=created,
                    resolution=resolution,
                )
            )
    assert [f.id for f in await store.list_open_findings(10)] == [new, old]
    assert [f.id for f in await store.list_open_findings(1)] == [new]
    after = FindingCursor(T0 + DAY, new)
    assert [f.id for f in await store.list_open_findings(10, after)] == [old]


async def test_a_pair_has_one_finding_per_kind(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    a, b = uuid.uuid4(), uuid.uuid4()
    assert await store.add_finding("duplicate", a, b)
    assert not await store.add_finding("duplicate", a, b)
    assert await store.add_finding("conflict", a, b)
    assert len(await store.list_open_findings(10)) == 2


async def test_a_finding_is_resolved_once(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    a, b = uuid.uuid4(), uuid.uuid4()
    await store.add_finding("duplicate", a, b)
    (finding,) = await store.list_open_findings(10)
    assert await store.resolve_finding(finding.id, "keep", "alice")
    assert not await store.resolve_finding(finding.id, "replace", "bob")
    resolved = await store.get_finding(finding.id)
    assert resolved is not None
    assert resolved.resolution == "keep"
    assert await store.get_finding(uuid.uuid4()) is None
    # A resolved pair is not found again.
    assert not await store.add_finding("duplicate", a, b)


async def test_resolutions_decide_which_findings_count_as_replacements(
    engine: AsyncEngine,
) -> None:
    store = SqlCurationStore(engine)
    older, newer, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await store.add_finding("superseded", older, newer)
    await store.add_finding("duplicate", older, other)
    await store.add_finding("conflict", older, uuid.uuid4())
    # Only the version found counts until someone decides.
    assert await store.count_replacements(older) == 1
    findings_by_kind = {f.kind: f for f in await store.list_open_findings(10)}
    await store.resolve_finding(findings_by_kind["duplicate"].id, "replace", "alice")
    assert await store.count_replacements(older) == 2
    await store.resolve_finding(findings_by_kind["superseded"].id, "keep", "alice")
    assert await store.count_replacements(older) == 1
    await store.resolve_finding(findings_by_kind["conflict"].id, "ignore", "alice")
    assert await store.count_replacements(older) == 1


async def test_the_latest_change_is_the_current_lifecycle_and_all_are_kept(
    engine: AsyncEngine,
) -> None:
    store = SqlCurationStore(engine)
    document, other = uuid.uuid4(), uuid.uuid4()
    assert await store.get_lifecycles([document]) == {}
    await store.add_lifecycle_change(document, Lifecycle("draft", "alice"), "first", "alice")
    await store.add_lifecycle_change(document, Lifecycle("approved", "bob", T0), "ok", "bob")
    await store.add_lifecycle_change(other, Lifecycle("deprecated", "alice"), "", "alice")
    current = await store.get_lifecycles([document, other, uuid.uuid4()])
    assert current == {
        document: Lifecycle("approved", "bob", T0),
        other: Lifecycle("deprecated", "alice"),
    }
    history = await store.list_lifecycle_history(document)
    assert [(c.lifecycle.state, c.note, c.changed_by) for c in history] == [
        ("approved", "ok", "bob"),
        ("draft", "first", "alice"),
    ]


async def test_review_is_due_for_the_current_lifecycle_unless_archived(
    engine: AsyncEngine,
) -> None:
    store = SqlCurationStore(engine)
    late, renewed, archived, none = (uuid.uuid4() for _ in range(4))
    now = T0 + 10 * DAY
    await store.add_lifecycle_change(late, Lifecycle("approved", "a", T0), "", "a")
    # An earlier date that was replaced by a later one is not due.
    await store.add_lifecycle_change(renewed, Lifecycle("approved", "a", T0), "", "a")
    await store.add_lifecycle_change(renewed, Lifecycle("approved", "a", T0 + 30 * DAY), "", "a")
    await store.add_lifecycle_change(archived, Lifecycle("archived", "a", T0), "", "a")
    await store.add_lifecycle_change(none, Lifecycle("approved", "a"), "", "a")
    assert await store.list_review_due(now, 10) == [late]


async def test_documents_with_a_reminder_are_not_due_again_so_a_batch_moves_on(
    engine: AsyncEngine,
) -> None:
    store = SqlCurationStore(engine)
    documents = [uuid.uuid4() for _ in range(3)]
    for document in documents:
        await store.add_lifecycle_change(document, Lifecycle("approved", "a", T0), "", "a")
    now = T0 + DAY
    first = await store.list_review_due(now, 2)
    assert len(first) == 2
    for document in first:
        await store.add_finding(REVIEW_DUE, document, document)
    (rest,) = await store.list_review_due(now, 2)
    assert rest not in first


async def test_a_review_reminder_is_a_finding_that_can_be_removed(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    document, other = uuid.uuid4(), uuid.uuid4()
    assert await store.add_finding(REVIEW_DUE, document, document)
    assert not await store.add_finding(REVIEW_DUE, document, document)
    assert await store.add_finding("duplicate", document, other)
    (reminder,) = [f for f in await store.list_open_findings(10) if f.kind == REVIEW_DUE]
    await store.resolve_finding(reminder.id, "keep", "alice")
    await store.delete_review_due(document)
    # Closed or not, the reminder goes with the next lifecycle change; others stay.
    assert [f.kind for f in await store.list_open_findings(10)] == ["duplicate"]
    assert await store.add_finding(REVIEW_DUE, document, document)
