"""Persistence for the chat module. Tables live in the "chat" schema; their
DDL is managed by the Alembic migrations in modules/chat/migrations."""

import asyncio
import pathlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

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
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine

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
)


@dataclass
class ConversationRow:
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


@dataclass
class MessageRow:
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: chat_pb2.MessageRole
    content: str
    created_at: datetime
    citations: list[dict[str, Any]] = field(default_factory=list)


class Repository(Protocol):
    async def create_conversation(self, title: str) -> ConversationRow: ...
    async def get_conversation(self, id: uuid.UUID) -> ConversationRow | None: ...
    async def list_conversations(self, limit: int, offset: int) -> list[ConversationRow]: ...
    async def delete_conversation(self, id: uuid.UUID) -> bool: ...
    async def set_title(self, id: uuid.UUID, title: str) -> None: ...
    async def list_messages(
        self, conversation_id: uuid.UUID, limit: int | None = None
    ) -> list[MessageRow]: ...
    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
    ) -> MessageRow: ...


class SqlRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create_conversation(self, title: str) -> ConversationRow:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                insert(conversations).values(id=uuid.uuid4(), title=title).returning(conversations)
            )
            row = result.mappings().one()
        return ConversationRow(**row)

    async def get_conversation(self, id: uuid.UUID) -> ConversationRow | None:
        async with self._engine.connect() as conn:
            result = await conn.execute(select(conversations).where(conversations.c.id == id))
            row = result.mappings().first()
        return ConversationRow(**row) if row else None

    async def list_conversations(self, limit: int, offset: int) -> list[ConversationRow]:
        query = (
            select(conversations)
            .order_by(conversations.c.updated_at.desc(), conversations.c.id.desc())
            .limit(limit)
            .offset(offset)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).mappings().all()
        return [ConversationRow(**r) for r in rows]

    async def delete_conversation(self, id: uuid.UUID) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(delete(conversations).where(conversations.c.id == id))
        return result.rowcount > 0

    async def set_title(self, id: uuid.UUID, title: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(conversations).where(conversations.c.id == id).values(title=title)
            )

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
