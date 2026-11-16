"""Persistence for the llm module. Tables live in the "llm" schema; their DDL
is managed by the Alembic migrations in modules/llm/migrations."""

import asyncio
import pathlib
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import Column, DateTime, Integer, MetaData, Table, Text, Uuid, func, insert, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .usage import UsageRecord, UsageSum

SCHEMA = "llm"
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[3] / "migrations"

metadata = MetaData(schema=SCHEMA)

usage = Table(
    "usage",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("user_id", Text, nullable=False),
    Column("caller_module", Text, nullable=False),
    Column("provider", Text, nullable=False),
    Column("model", Text, nullable=False),
    Column("input_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
    Column("latency_ms", Integer, nullable=False),
)


class SqlUsageStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def record(self, record: UsageRecord) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                insert(usage).values(
                    id=uuid.uuid4(),
                    user_id=record.user_id,
                    caller_module=record.caller_module,
                    provider=record.provider,
                    model=record.model,
                    input_tokens=record.input_tokens,
                    output_tokens=record.output_tokens,
                    latency_ms=record.latency_ms,
                )
            )

    async def summarize(self, days: int, user_id: str | None) -> list[UsageSum]:
        day = func.to_char(func.timezone("UTC", usage.c.created_at), "YYYY-MM-DD").label("date")
        # Midnight UTC of the first day: today is day 1.
        since = func.date_trunc("day", func.timezone("UTC", func.now())) - func.make_interval(
            0, 0, 0, days - 1
        )
        query = (
            select(
                day,
                usage.c.provider,
                usage.c.model,
                usage.c.caller_module,
                func.count().label("requests"),
                func.sum(usage.c.input_tokens).label("input_tokens"),
                func.sum(usage.c.output_tokens).label("output_tokens"),
            )
            .where(func.timezone("UTC", usage.c.created_at) >= since)
            .group_by(day, usage.c.provider, usage.c.model, usage.c.caller_module)
            .order_by(day.desc(), usage.c.model, usage.c.caller_module, usage.c.provider)
        )
        if user_id is not None:
            query = query.where(usage.c.user_id == user_id)
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [UsageSum(**r) for r in rows]


def _upgrade(database_url: str) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


async def migrate(database_url: str) -> None:
    """Apply Alembic migrations. env.py runs its own event loop, so it is run
    in a worker thread."""
    await asyncio.to_thread(_upgrade, database_url)
