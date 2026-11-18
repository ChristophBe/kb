"""SqlCurationStore against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
import datetime
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from knowcel_curation.db import SqlCurationStore, document_scores, findings, migrate
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration

# The image of deploy/infra.compose.yaml, as in modules/llm's tests.
IMAGE = "pgvector/pgvector:pg17"


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


async def test_get_score(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    document = uuid.uuid4()
    assert await store.get_score(document) is None
    async with engine.begin() as conn:
        await conn.execute(insert(document_scores).values(document_id=document, score=0.5))
    score = await store.get_score(document)
    assert score is not None
    assert (score.document_id, score.score) == (document, 0.5)


async def test_list_findings_newest_first(engine: AsyncEngine) -> None:
    store = SqlCurationStore(engine)
    a, b = uuid.uuid4(), uuid.uuid4()
    old, new = uuid.uuid4(), uuid.uuid4()
    day = datetime.datetime(2026, 11, 1, tzinfo=datetime.UTC)
    async with engine.begin() as conn:
        for id_, kind, created in (
            (old, "duplicate", day),
            (new, "superseded", day + datetime.timedelta(days=1)),
        ):
            await conn.execute(
                insert(findings).values(
                    id=id_, kind=kind, document_id=a, other_document_id=b, created_at=created
                )
            )
    assert [f.id for f in await store.list_findings()] == [new, old]
