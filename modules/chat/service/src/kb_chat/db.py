"""Persistence for the chat module. Tables live in the "chat" schema; their
DDL is managed by the Alembic migrations in modules/chat/migrations."""

import asyncio
import pathlib
import re
import uuid
from typing import Any

from alembic import command
from alembic.config import Config
from kb.chat.v1 import chat_pb2
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    MetaData,
    SmallInteger,
    Table,
    Text,
    Uuid,
    delete,
    func,
    insert,
    literal_column,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.sql.elements import ColumnElement

from .preview import plain_text, preview
from .repository import ConversationMatch, ConversationRow, MessageRow

SCHEMA = "chat"
MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parents[3] / "migrations"

metadata = MetaData(schema=SCHEMA)

conversations = Table(
    "conversations",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column("title", Text, nullable=False, server_default=""),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("document_ids", ARRAY(Uuid), nullable=False, server_default="{}"),
    Column("owner_id", Text, nullable=False),
)

messages = Table(
    "messages",
    metadata,
    Column("id", Uuid, primary_key=True),
    Column(
        "conversation_id", Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    ),
    Column("role", SmallInteger, nullable=False),
    Column("content", Text, nullable=False),
    Column("citations", JSONB, nullable=False, server_default="[]"),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    # kb.chat.v1.MessageStatus
    Column("status", SmallInteger, nullable=False, server_default="1"),
)


# The latest message of each conversation. Ties on created_at (one transaction)
# go to the higher id, as in list_conversations.
_last_message = (
    select(
        messages.c.created_at.label("last_message_time"),
        # Enough text for a preview even after Markdown is removed.
        func.left(messages.c.content, 1000).label("last_message_content"),
    )
    .where(messages.c.conversation_id == conversations.c.id)
    .order_by(messages.c.created_at.desc(), messages.c.id.desc())
    .limit(1)
    .lateral("last_message")
)

_conversations_with_last_message = select(
    conversations, _last_message.c.last_message_time, _last_message.c.last_message_content
).select_from(conversations.outerjoin(_last_message, true()))


def _conversation(row: Any) -> ConversationRow:
    values = dict(row)
    content = values.pop("last_message_content", None)
    return ConversationRow(**values, last_message_preview=preview(content or ""))


def _owned(owner: str, id: uuid.UUID) -> ColumnElement[bool]:
    """The conversation `id` if `owner` owns it; another user's is missing."""
    return (conversations.c.id == id) & (conversations.c.owner_id == owner)


# Full-text search. The tsvector expressions match the indexes of migration
# 0004; the configuration is a literal so that the planner can use them.
_SEARCH_CONFIG = literal_column("'simple'::regconfig")
# The words of a query, as the "simple" parser splits them.
_WORD = re.compile(r"[^\W_]+")
_HEADLINE_OPTIONS = "MaxWords=20, MinWords=8"


def _tsvector(column: ColumnElement[str]) -> ColumnElement[Any]:
    return func.to_tsvector(_SEARCH_CONFIG, column)


def _tsquery(query: str) -> str | None:
    """Every word of `query` as a prefix, all required, for to_tsquery; None
    when it has no words."""
    words = _WORD.findall(query.lower())
    return " & ".join(f"'{w}':*" for w in words) if words else None


class SqlRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create_conversation(
        self, owner: str, title: str, document_ids: list[uuid.UUID]
    ) -> ConversationRow:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                insert(conversations)
                .values(id=uuid.uuid4(), owner_id=owner, title=title, document_ids=document_ids)
                .returning(conversations)
            )
            row = result.mappings().one()
        return ConversationRow(**row)

    async def get_conversation(self, owner: str, id: uuid.UUID) -> ConversationRow | None:
        async with self._engine.connect() as conn:
            result = await conn.execute(_conversations_with_last_message.where(_owned(owner, id)))
            row = result.mappings().first()
        return _conversation(row) if row else None

    async def list_conversations(
        self, owner: str, limit: int, offset: int
    ) -> list[ConversationRow]:
        query = (
            _conversations_with_last_message.where(conversations.c.owner_id == owner)
            .order_by(
                func.coalesce(_last_message.c.last_message_time, conversations.c.created_at).desc(),
                conversations.c.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [_conversation(r) for r in rows]

    async def search_conversations(
        self, owner: str, query: str, limit: int
    ) -> list[ConversationMatch]:
        tsquery = _tsquery(query)
        if tsquery is None:
            return []
        q = func.to_tsquery(_SEARCH_CONFIG, tsquery)
        content_matches = _tsvector(messages.c.content).op("@@")(q)
        rank = func.ts_rank(_tsvector(messages.c.content), q)
        # Each conversation's best matching message; ties go to the latest one.
        ranked = (
            select(
                messages.c.conversation_id,
                messages.c.content,
                rank.label("rank"),
                func.row_number()
                .over(
                    partition_by=messages.c.conversation_id,
                    order_by=(rank.desc(), messages.c.created_at.desc(), messages.c.id.desc()),
                )
                .label("place"),
            )
            .select_from(
                messages.join(conversations, conversations.c.id == messages.c.conversation_id)
            )
            .where(conversations.c.owner_id == owner, content_matches)
            .subquery("ranked_messages")
        )
        best = (
            select(ranked.c.conversation_id, ranked.c.content, ranked.c.rank)
            .where(ranked.c.place == 1)
            .subquery("best_message")
        )
        title_matches = _tsvector(conversations.c.title).op("@@")(q)
        stmt = (
            select(
                conversations,
                _last_message.c.last_message_time,
                _last_message.c.last_message_content,
                func.ts_headline(_SEARCH_CONFIG, best.c.content, q, _HEADLINE_OPTIONS).label(
                    "snippet"
                ),
            )
            .select_from(
                conversations.outerjoin(_last_message, true()).outerjoin(
                    best, best.c.conversation_id == conversations.c.id
                )
            )
            .where(
                conversations.c.owner_id == owner,
                or_(title_matches, best.c.conversation_id.is_not(None)),
            )
            .order_by(
                title_matches.desc(),
                best.c.rank.desc().nulls_last(),
                func.coalesce(_last_message.c.last_message_time, conversations.c.created_at).desc(),
                conversations.c.id.desc(),
            )
            .limit(limit)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(stmt)).mappings().all()
        matches = []
        for row in rows:
            values = dict(row)
            # ts_headline marks the matched words with <b>; plain_text drops
            # those tags along with the message's Markdown.
            snippet = plain_text(values.pop("snippet") or "")
            matches.append(ConversationMatch(_conversation(values), snippet))
        return matches

    async def delete_conversation(self, owner: str, id: uuid.UUID) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(delete(conversations).where(_owned(owner, id)))
        return result.rowcount > 0

    async def set_title(self, id: uuid.UUID, title: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(conversations).where(conversations.c.id == id).values(title=title)
            )

    async def update_conversation(
        self,
        owner: str,
        id: uuid.UUID,
        *,
        title: str | None = None,
        document_ids: list[uuid.UUID] | None = None,
    ) -> ConversationRow | None:
        values: dict[str, Any] = {"updated_at": func.now()}
        if title is not None:
            values["title"] = title
        if document_ids is not None:
            values["document_ids"] = document_ids
        async with self._engine.begin() as conn:
            await conn.execute(update(conversations).where(_owned(owner, id)).values(**values))
            result = await conn.execute(_conversations_with_last_message.where(_owned(owner, id)))
            row = result.mappings().first()
        return _conversation(row) if row else None

    async def list_messages(
        self, conversation_id: uuid.UUID, limit: int | None = None
    ) -> list[MessageRow]:
        query = (
            select(messages)
            .where(messages.c.conversation_id == conversation_id)
            .order_by(messages.c.created_at.desc())
        )
        if limit is not None:
            query = query.limit(limit)
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [MessageRow(**r) for r in reversed(rows)]

    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
        status: chat_pb2.MessageStatus = chat_pb2.MESSAGE_STATUS_COMPLETE,
    ) -> MessageRow:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                insert(messages)
                .values(
                    id=uuid.uuid4(),
                    conversation_id=conversation_id,
                    role=role,
                    content=content,
                    citations=citations,
                    status=status,
                )
                .returning(messages)
            )
            row = result.mappings().one()
            await conn.execute(
                update(conversations)
                .where(conversations.c.id == conversation_id)
                .values(updated_at=func.now())
            )
        return MessageRow(**row)


def _upgrade(database_url: str) -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


async def migrate(database_url: str) -> None:
    """Apply Alembic migrations. env.py runs its own event loop, so it is run
    in a worker thread."""
    await asyncio.to_thread(_upgrade, database_url)
