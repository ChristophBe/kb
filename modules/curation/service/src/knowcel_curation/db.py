"""Persistence for the curation module. Tables live in the "curation" schema;
their DDL is managed by the Alembic migrations in modules/curation/migrations."""

import asyncio
import datetime
import pathlib
import uuid
from collections.abc import Collection

from alembic import command
from alembic.config import Config
from sqlalchemy import (
    Column,
    DateTime,
    Double,
    MetaData,
    RowMapping,
    Table,
    Text,
    Uuid,
    and_,
    delete,
    exists,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import distinct_on, insert
from sqlalchemy.ext.asyncio import AsyncEngine

from .curation import (
    ARCHIVED,
    REPLACE,
    REVIEW_DUE,
    SUPERSEDED,
    Finding,
    FindingCursor,
    Lifecycle,
    LifecycleChange,
    Score,
)

SCHEMA = "curation"
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[3] / "migrations"

metadata = MetaData(schema=SCHEMA)

document_scores = Table(
    "document_scores",
    metadata,
    Column("document_id", Uuid, primary_key=True),
    Column("score", Double, nullable=False),
    Column("processed_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
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
    Column("resolution", Text),
    Column("resolved_at", DateTime(timezone=True)),
    Column("resolved_by", Text),
)

document_lifecycle = Table(
    "document_lifecycle",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("document_id", Uuid, nullable=False),
    Column("state", Text, nullable=False),
    Column("owner", Text, nullable=False),
    Column("review_by", DateTime(timezone=True)),
    Column("note", Text, nullable=False),
    Column("changed_by", Text, nullable=False),
    Column("changed_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

_FINDING_COLUMNS = (
    findings.c.id,
    findings.c.kind,
    findings.c.document_id,
    findings.c.other_document_id,
    findings.c.created_at,
    findings.c.resolution,
)


class SqlCurationStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def get_scores(self, document_ids: Collection[uuid.UUID]) -> list[Score]:
        query = select(document_scores).where(document_scores.c.document_id.in_(document_ids))
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [Score(**r) for r in rows]

    async def save_score(
        self, document_id: uuid.UUID, processed_at: datetime.datetime, score: float
    ) -> None:
        statement = insert(document_scores).values(
            document_id=document_id, processed_at=processed_at, score=score
        )
        async with self._engine.begin() as conn:
            await conn.execute(
                statement.on_conflict_do_update(
                    index_elements=["document_id"],
                    set_={
                        "processed_at": statement.excluded.processed_at,
                        "score": statement.excluded.score,
                        "updated_at": func.now(),
                    },
                    # A writer that read an older state (a rescore running
                    # while a document is processed again) can't overwrite
                    # the score of a newer one.
                    where=statement.excluded.processed_at >= document_scores.c.processed_at,
                )
            )

    async def list_scores(self, after: uuid.UUID | None, limit: int) -> list[Score]:
        query = select(document_scores).order_by(document_scores.c.document_id).limit(limit)
        if after is not None:
            query = query.where(document_scores.c.document_id > after)
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [Score(**r) for r in rows]

    async def count_replacements(self, document_id: uuid.UUID) -> int:
        query = (
            select(func.count())
            .select_from(findings)
            .where(
                findings.c.document_id == document_id,
                # A version found is a replacement until someone decides
                # otherwise; any other finding only when confirmed.
                or_(
                    and_(findings.c.kind == SUPERSEDED, findings.c.resolution.is_(None)),
                    findings.c.resolution == REPLACE,
                ),
            )
        )
        async with self._engine.connect() as conn:
            return (await conn.execute(query)).scalar_one()

    async def add_finding(
        self, kind: str, document_id: uuid.UUID, other_document_id: uuid.UUID
    ) -> bool:
        statement = (
            insert(findings)
            .values(
                id=uuid.uuid4(),
                kind=kind,
                document_id=document_id,
                other_document_id=other_document_id,
            )
            .on_conflict_do_nothing(index_elements=["kind", "document_id", "other_document_id"])
            .returning(findings.c.id)
        )
        async with self._engine.begin() as conn:
            return (await conn.execute(statement)).first() is not None

    async def get_finding(self, finding_id: uuid.UUID) -> Finding | None:
        async with self._engine.connect() as conn:
            row = (
                (await conn.execute(select(*_FINDING_COLUMNS).where(findings.c.id == finding_id)))
                .mappings()
                .first()
            )
        return Finding(**row) if row else None

    async def resolve_finding(self, finding_id: uuid.UUID, resolution: str, user: str) -> bool:
        statement = (
            update(findings)
            .where(findings.c.id == finding_id, findings.c.resolution.is_(None))
            .values(resolution=resolution, resolved_at=func.now(), resolved_by=user)
            .returning(findings.c.id)
        )
        async with self._engine.begin() as conn:
            return (await conn.execute(statement)).first() is not None

    async def list_open_findings(
        self, limit: int, after: FindingCursor | None = None
    ) -> list[Finding]:
        query = (
            select(*_FINDING_COLUMNS)
            .where(findings.c.resolution.is_(None))
            .order_by(findings.c.created_at.desc(), findings.c.id)
            .limit(limit)
        )
        if after is not None:
            query = query.where(
                or_(
                    findings.c.created_at < after.created_at,
                    and_(findings.c.created_at == after.created_at, findings.c.id > after.id),
                )
            )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [Finding(**r) for r in rows]

    async def get_lifecycles(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, Lifecycle]:
        query = (
            select(document_lifecycle)
            .where(document_lifecycle.c.document_id.in_(document_ids))
            .ext(distinct_on(document_lifecycle.c.document_id))
            .order_by(document_lifecycle.c.document_id, document_lifecycle.c.changed_at.desc())
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return {r["document_id"]: _lifecycle(r) for r in rows}

    async def add_lifecycle_change(
        self, document_id: uuid.UUID, lifecycle: Lifecycle, note: str, user: str
    ) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                insert(document_lifecycle).values(
                    id=uuid.uuid4(),
                    document_id=document_id,
                    state=lifecycle.state,
                    owner=lifecycle.owner,
                    review_by=lifecycle.review_by,
                    note=note,
                    changed_by=user,
                )
            )

    async def list_lifecycle_history(self, document_id: uuid.UUID) -> list[LifecycleChange]:
        query = (
            select(document_lifecycle)
            .where(document_lifecycle.c.document_id == document_id)
            .order_by(document_lifecycle.c.changed_at.desc(), document_lifecycle.c.id)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [
            LifecycleChange(_lifecycle(r), r["note"], r["changed_by"], r["changed_at"])
            for r in rows
        ]

    async def list_review_due(self, now: datetime.datetime, limit: int) -> list[uuid.UUID]:
        latest = (
            select(document_lifecycle)
            .ext(distinct_on(document_lifecycle.c.document_id))
            .order_by(document_lifecycle.c.document_id, document_lifecycle.c.changed_at.desc())
            .subquery()
        )
        query = (
            select(latest.c.document_id)
            .where(
                latest.c.review_by < now,
                latest.c.state != ARCHIVED,
                # Those already reminded (or dismissed) are done until their date changes.
                ~exists().where(
                    findings.c.kind == REVIEW_DUE, findings.c.document_id == latest.c.document_id
                ),
            )
            .limit(limit)
        )
        async with self._engine.connect() as conn:
            return list((await conn.execute(query)).scalars())

    async def delete_review_due(self, document_id: uuid.UUID) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(findings).where(
                    findings.c.document_id == document_id, findings.c.kind == REVIEW_DUE
                )
            )


def _lifecycle(row: RowMapping) -> Lifecycle:
    return Lifecycle(row["state"], row["owner"], row["review_by"])


def _upgrade(database_url: str) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


async def migrate(database_url: str) -> None:
    """Apply Alembic migrations. env.py runs its own event loop, so it is run
    in a worker thread."""
    await asyncio.to_thread(_upgrade, database_url)
