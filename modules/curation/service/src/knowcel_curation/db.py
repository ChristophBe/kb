"""Persistence for the curation module. Tables live in the "curation" schema;
their DDL is managed by the Alembic migrations in modules/curation/migrations."""

import asyncio
import pathlib
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import Column, DateTime, Double, MetaData, Table, Text, Uuid, func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .curation import Finding, Score

SCHEMA = "curation"
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[3] / "migrations"

metadata = MetaData(schema=SCHEMA)

document_scores = Table(
    "document_scores",
    metadata,
    Column("document_id", Uuid, primary_key=True),
    Column("score", Double, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

findings = Table(
    "findings",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("kind", Text, nullable=False),
    Column("document_id", Uuid, nullable=False),
    Column("other_document_id", Uuid, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)


class SqlCurationStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def get_score(self, document_id: uuid.UUID) -> Score | None:
        query = select(document_scores).where(document_scores.c.document_id == document_id)
        async with self._engine.connect() as conn:
            row = (await conn.execute(query)).mappings().first()
        return Score(**row) if row else None

    async def list_findings(self) -> list[Finding]:
        query = select(findings).order_by(findings.c.created_at.desc(), findings.c.id)
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [Finding(**r) for r in rows]


def _upgrade(database_url: str) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


async def migrate(database_url: str) -> None:
    """Apply Alembic migrations. env.py runs its own event loop, so it is run
    in a worker thread."""
    await asyncio.to_thread(_upgrade, database_url)
