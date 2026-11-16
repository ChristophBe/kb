"""SqlUsageStore against a real Postgres (needs Docker; run by `task test:integration`)."""

import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest
from knowcel_llm.db import SqlUsageStore, migrate, usage
from knowcel_llm.usage import UsageRecord
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration

# The image of deploy/infra.compose.yaml, as in modules/chat's tests.
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
        await conn.execute(text("TRUNCATE llm.usage"))
    yield engine
    await engine.dispose()


@pytest.fixture
def store(engine: AsyncEngine) -> SqlUsageStore:
    return SqlUsageStore(engine)


def record(user: str, model: str = "m", module: str = "chat", tokens: int = 10) -> UsageRecord:
    return UsageRecord(user, module, "fake", model, tokens, tokens * 2, 5)


async def test_usage_is_summed_per_day_model_and_module(store: SqlUsageStore) -> None:
    for r in (record("a", "m1"), record("b", "m1"), record("a", "m2"), record("a", "m1", "docs")):
        await store.record(r)

    sums = await store.summarize(30, None)

    totals = [(s.model, s.caller_module, s.requests, s.input_tokens, s.output_tokens) for s in sums]
    assert totals == [
        ("m1", "chat", 2, 20, 40),
        ("m1", "docs", 1, 10, 20),
        ("m2", "chat", 1, 10, 20),
    ]
    assert len({s.date for s in sums}) == 1


async def test_a_user_sums_only_their_own_usage(store: SqlUsageStore) -> None:
    await store.record(record("a"))
    await store.record(record("b", tokens=5))

    (mine,) = await store.summarize(30, "b")

    assert (mine.requests, mine.input_tokens) == (1, 5)
    assert await store.summarize(30, "nobody") == []


async def test_only_the_requested_days_are_summed(
    store: SqlUsageStore, engine: AsyncEngine
) -> None:
    await store.record(record("a"))
    await store.record(record("a", "old"))
    async with engine.begin() as conn:
        await conn.execute(
            update(usage)
            .where(usage.c.model == "old")
            .values(created_at=text("now() - interval '3 days'"))
        )

    assert {s.model for s in await store.summarize(1, None)} == {"m"}
    assert {s.model for s in await store.summarize(3, None)} == {"m"}
    assert {s.model for s in await store.summarize(4, None)} == {"m", "old"}
    sums = await store.summarize(30, None)
    assert [s.model for s in sums] == ["m", "old"]  # newest day first
