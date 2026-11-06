"""Persistence for the chat module. Tables live in the "chat" schema; their
DDL is managed by the Alembic migrations in modules/chat/migrations."""

import asyncio
import pathlib
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
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import AsyncEngine

from .preview import preview
from .repository import ConversationRow, MessageRow

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


class SqlRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create_conversation(
        self, title: str, document_ids: list[uuid.UUID]
    ) -> ConversationRow:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                insert(conversations)
                .values(id=uuid.uuid4(), title=title, document_ids=document_ids)
                .returning(conversations)
            )
            row = result.mappings().one()
        return ConversationRow(**row)

    async def get_conversation(self, id: uuid.UUID) -> ConversationRow | None:
        async with self._engine.connect() as conn:
            result = await conn.execute(
                _conversations_with_last_message.where(conversations.c.id == id)
            )
            row = result.mappings().first()
        return _conversation(row) if row else None

    async def list_conversations(self, limit: int, offset: int) -> list[ConversationRow]:
        query = (
            _conversations_with_last_message.order_by(
                func.coalesce(_last_message.c.last_message_time, conversations.c.created_at).desc(),
                conversations.c.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [_conversation(r) for r in rows]

    async def delete_conversation(self, id: uuid.UUID) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(delete(conversations).where(conversations.c.id == id))
        return result.rowcount > 0

    async def set_title(self, id: uuid.UUID, title: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(conversations).where(conversations.c.id == id).values(title=title)
            )

    async def update_conversation(
        self,
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
            await conn.execute(
                update(conversations).where(conversations.c.id == id).values(**values)
            )
            result = await conn.execute(
                _conversations_with_last_message.where(conversations.c.id == id)
            )
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
