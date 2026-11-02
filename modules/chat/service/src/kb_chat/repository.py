"""The persistence the chat module needs; db.py implements it."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from kb.chat.v1 import chat_pb2


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
