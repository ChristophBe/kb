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
    # The documents answers are grounded in; empty means all documents.
    document_ids: list[uuid.UUID] = field(default_factory=list)
    # None while the conversation has no messages.
    last_message_time: datetime | None = None
    last_message_preview: str = ""


@dataclass
class ConversationMatch:
    conversation: ConversationRow
    # An excerpt of the best matching message as plain text; empty when only
    # the title matches.
    snippet: str = ""


@dataclass
class MessageRow:
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: chat_pb2.MessageRole
    content: str
    created_at: datetime
    citations: list[dict[str, Any]] = field(default_factory=list)
    status: chat_pb2.MessageStatus = chat_pb2.MESSAGE_STATUS_COMPLETE


class Repository(Protocol):
    async def create_conversation(
        self, title: str, document_ids: list[uuid.UUID]
    ) -> ConversationRow: ...
    async def get_conversation(self, id: uuid.UUID) -> ConversationRow | None: ...
    async def list_conversations(self, limit: int, offset: int) -> list[ConversationRow]:
        """Newest latest message first; a conversation without messages counts
        from its creation."""
        ...

    async def search_conversations(self, query: str, limit: int) -> list[ConversationMatch]:
        """Conversations whose title or one of whose messages contains every
        word of `query` (as a word prefix, ignoring case): title matches first,
        then message matches, each best match first, each conversation once."""
        ...

    async def delete_conversation(self, id: uuid.UUID) -> bool: ...
    async def set_title(self, id: uuid.UUID, title: str) -> None: ...
    async def update_conversation(
        self,
        id: uuid.UUID,
        *,
        title: str | None = None,
        document_ids: list[uuid.UUID] | None = None,
    ) -> ConversationRow | None:
        """Changes the fields that are not None and keeps the others."""
        ...

    async def list_messages(
        self, conversation_id: uuid.UUID, limit: int | None = None
    ) -> list[MessageRow]: ...
    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
        status: chat_pb2.MessageStatus = chat_pb2.MESSAGE_STATUS_COMPLETE,
    ) -> MessageRow: ...
