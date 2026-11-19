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
    Integer,
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
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from .curation import (
    ARCHIVED,
    DEPRECATE,
    HELPFUL,
    REPLACE,
    REPORTED,
    REVIEW_DUE,
    SUPERSEDED,
    Finding,
    FindingCursor,
    Lifecycle,
    LifecycleChange,
    Report,
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

ratings = Table(
    "ratings",
    metadata,
    Column("document_id", Uuid, primary_key=True),
    Column("user_id", Text, primary_key=True),
    # -1 is the document as a whole.
    Column("chunk_index", Integer, primary_key=True, server_default="-1"),
    Column("rating", Text, nullable=False),
    Column("conversation_id", Text, nullable=False, server_default=""),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

reports = Table(
    "reports",
    metadata,
    Column("document_id", Uuid, primary_key=True),
    Column("reporter", Text, primary_key=True),
    Column("reason", Text, nullable=False),
    Column("comment", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("closed_at", DateTime(timezone=True)),
)

_FINDING_COLUMNS = (
    findings.c.id,
    findings.c.kind,
    findings.c.document_id,
    findings.c.other_document_id,
    findings.c.created_at,
    findings.c.resolution,
)


# A version found is a replacement until someone decides otherwise; any other
# finding only when confirmed.
_REPLACED = or_(
    and_(findings.c.kind == SUPERSEDED, findings.c.resolution.is_(None)),
    findings.c.resolution == REPLACE,
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
            .where(findings.c.document_id == document_id, _REPLACED)
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
            .returning(findings.c.kind, findings.c.document_id)
        )
        async with self._engine.begin() as conn:
            row = (await conn.execute(statement)).first()
            if row is None:
                return False
            if row.kind == REPORTED:
                await _close_reports(conn, row.document_id)
            return True

    async def close_report_finding(self, document_id: uuid.UUID, user: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(findings)
                .where(
                    findings.c.document_id == document_id,
                    findings.c.kind == REPORTED,
                    findings.c.resolution.is_(None),
                )
                .values(resolution=DEPRECATE, resolved_at=func.now(), resolved_by=user)
            )
            await _close_reports(conn, document_id)

    async def list_open_findings(
        self,
        limit: int,
        after: FindingCursor | None = None,
        kinds: Collection[str] = (),
    ) -> list[Finding]:
        query = (
            select(*_FINDING_COLUMNS)
            .where(findings.c.resolution.is_(None))
            .order_by(findings.c.created_at.desc(), findings.c.id)
            .limit(limit)
        )
        if kinds:
            query = query.where(findings.c.kind.in_(kinds))
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

    async def get_replacements(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, set[uuid.UUID]]:
        query = select(findings.c.document_id, findings.c.other_document_id).where(
            findings.c.document_id.in_(document_ids), _REPLACED
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).all()
        replacements: dict[uuid.UUID, set[uuid.UUID]] = {}
        for document_id, other_id in rows:
            replacements.setdefault(document_id, set()).add(other_id)
        return replacements

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
            # Longest overdue first, so a batch moves on deterministically.
            .order_by(latest.c.review_by, latest.c.document_id)
            .limit(limit)
        )
        async with self._engine.connect() as conn:
            return list((await conn.execute(query)).scalars())

    async def save_rating(
        self,
        document_id: uuid.UUID,
        user: str,
        chunk_index: int | None,
        rating: str,
        conversation_id: str,
    ) -> None:
        statement = insert(ratings).values(
            document_id=document_id,
            user_id=user,
            chunk_index=_chunk(chunk_index),
            rating=rating,
            conversation_id=conversation_id,
        )
        async with self._engine.begin() as conn:
            await conn.execute(
                statement.on_conflict_do_update(
                    index_elements=["document_id", "user_id", "chunk_index"],
                    set_={
                        "rating": statement.excluded.rating,
                        "conversation_id": statement.excluded.conversation_id,
                        "updated_at": func.now(),
                    },
                )
            )

    async def delete_rating(
        self, document_id: uuid.UUID, user: str, chunk_index: int | None
    ) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(ratings).where(
                    ratings.c.document_id == document_id,
                    ratings.c.user_id == user,
                    ratings.c.chunk_index == _chunk(chunk_index),
                )
            )

    async def get_rating(
        self, document_id: uuid.UUID, user: str, chunk_index: int | None
    ) -> str | None:
        query = select(ratings.c.rating).where(
            ratings.c.document_id == document_id,
            ratings.c.user_id == user,
            ratings.c.chunk_index == _chunk(chunk_index),
        )
        async with self._engine.connect() as conn:
            return (await conn.execute(query)).scalar_one_or_none()

    async def rating_counts(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[int, int]]:
        query = (
            select(ratings.c.document_id, ratings.c.rating, func.count())
            .where(ratings.c.document_id.in_(document_ids))
            .group_by(ratings.c.document_id, ratings.c.rating)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).all()
        counts: dict[uuid.UUID, list[int]] = {}
        for document_id, rating, n in rows:
            pair = counts.setdefault(document_id, [0, 0])
            pair[0 if rating == HELPFUL else 1] += n
        return {i: (h, u) for i, (h, u) in counts.items()}

    async def save_report(
        self, document_id: uuid.UUID, reporter: str, reason: str, comment: str
    ) -> None:
        statement = insert(reports).values(
            document_id=document_id, reporter=reporter, reason=reason, comment=comment
        )
        async with self._engine.begin() as conn:
            await conn.execute(
                statement.on_conflict_do_update(
                    index_elements=["document_id", "reporter"],
                    set_={
                        "reason": statement.excluded.reason,
                        "comment": statement.excluded.comment,
                        "created_at": func.now(),
                        "closed_at": None,
                    },
                )
            )

    async def list_reports(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, list[Report]]:
        query = (
            select(reports)
            .where(reports.c.document_id.in_(document_ids), reports.c.closed_at.is_(None))
            .order_by(reports.c.created_at, reports.c.reporter)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        found: dict[uuid.UUID, list[Report]] = {}
        for r in rows:
            found.setdefault(r["document_id"], []).append(
                Report(r["document_id"], r["reporter"], r["reason"], r["comment"], r["created_at"])
            )
        return found

    async def delete_resolved_finding(self, kind: str, document_id: uuid.UUID) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(findings).where(
                    findings.c.document_id == document_id,
                    findings.c.kind == kind,
                    findings.c.resolution.is_not(None),
                )
            )

    async def delete_review_due(self, document_id: uuid.UUID) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(findings).where(
                    findings.c.document_id == document_id, findings.c.kind == REVIEW_DUE
                )
            )


async def _close_reports(conn: AsyncConnection, document_id: uuid.UUID) -> None:
    """The open reports of a document stop counting."""
    await conn.execute(
        update(reports)
        .where(reports.c.document_id == document_id, reports.c.closed_at.is_(None))
        .values(closed_at=func.now())
    )


def _chunk(chunk_index: int | None) -> int:
    """How the rated passage is stored: -1 for the document as a whole."""
    return -1 if chunk_index is None else chunk_index


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
