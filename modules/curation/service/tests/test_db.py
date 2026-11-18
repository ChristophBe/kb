"""SqlCurationStore against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
import datetime
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
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
        await conn.execute(text("TRUNCATE curation.document_scores, curation.findings"))
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


async def test_list_findings_newest_first(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    a, b = uuid.uuid4(), uuid.uuid4()
    old, new = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as conn:
        for id_, kind, created in (
            (old, "duplicate", T0),
            (new, "superseded", T0 + DAY),
        ):
            await conn.execute(
                insert(findings).values(
                    id=id_, kind=kind, document_id=a, other_document_id=b, created_at=created
                )
            )
    assert [f.id for f in await store.list_findings()] == [new, old]
