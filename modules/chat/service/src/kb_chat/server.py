import logging
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import grpc
from google.protobuf.timestamp_pb2 import Timestamp
from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.common.v1 import common_pb2

from .chat import (
    AnswerDelta,
    AnswerEvent,
    AnswerSaved,
    Chat,
    ConversationNotFoundError,
    PeerError,
    PeerUnavailableError,
    SourcesFound,
)
from .repository import ConversationRow, MessageRow, Repository

log = logging.getLogger("kb_chat")

_Context = grpc.aio.ServicerContext[Any, Any]

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class ChatServicer(chat_pb2_grpc.ChatServiceServicer):
    def __init__(self, repo: Repository, chat: Chat) -> None:
        self._repo = repo
        self._chat = chat

    async def CreateConversation(
        self, request: chat_pb2.CreateConversationRequest, context: _Context
    ) -> chat_pb2.CreateConversationResponse:
        conv = await self._repo.create_conversation(request.title)
        return chat_pb2.CreateConversationResponse(conversation=_conversation(conv))

    async def GetConversation(
        self, request: chat_pb2.GetConversationRequest, context: _Context
    ) -> chat_pb2.GetConversationResponse:
        conv = await self._get(request.id, context)
        msgs = await self._repo.list_messages(conv.id)
        return chat_pb2.GetConversationResponse(
            conversation=_conversation(conv), messages=[_message(m) for m in msgs]
        )

    async def ListConversations(
        self, request: chat_pb2.ListConversationsRequest, context: _Context
    ) -> chat_pb2.ListConversationsResponse:
        limit = min(request.page.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        try:
            offset = int(request.page.page_token or 0)
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "invalid page token")
        rows = await self._repo.list_conversations(limit + 1, offset)
        token = str(offset + limit) if len(rows) > limit else ""
        return chat_pb2.ListConversationsResponse(
            conversations=[_conversation(c) for c in rows[:limit]],
            page=common_pb2.PageResponse(next_page_token=token),
        )

    async def DeleteConversation(
        self, request: chat_pb2.DeleteConversationRequest, context: _Context
    ) -> chat_pb2.DeleteConversationResponse:
        if not await self._repo.delete_conversation(_parse_id(request.id)):
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        return chat_pb2.DeleteConversationResponse()

    async def StreamChat(
        self, request: chat_pb2.StreamChatRequest, context: _Context
    ) -> AsyncIterator[chat_pb2.StreamChatResponse]:
        content = request.content.strip()
        if not content:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "content must not be empty")
        events = self._chat.answer(
            _parse_id(request.conversation_id), content, request.model, request.use_knowledge_base
        )
        # The document and llm modules are soft dependencies: while one is down,
        # the call fails with UNAVAILABLE instead of an unmapped error.
        try:
            async for event in events:
                yield _response(event)
        except ConversationNotFoundError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        except PeerUnavailableError as err:
            log.warning("peer unavailable: %s", err)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "a required service is unavailable")
        except PeerError as err:
            log.error("peer call failed: %s", err)
            await context.abort(grpc.StatusCode.INTERNAL, "answer generation failed")

    async def _get(self, raw_id: str, context: _Context) -> ConversationRow:
        conv = await self._repo.get_conversation(_parse_id(raw_id))
        if conv is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        assert conv is not None
        return conv


def _parse_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        # Unknown ids and malformed ids are both "not found" for callers.
        return uuid.UUID(int=0)


def _ts(value: datetime) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def _conversation(c: ConversationRow) -> chat_pb2.Conversation:
    return chat_pb2.Conversation(
        id=str(c.id), title=c.title, create_time=_ts(c.created_at), update_time=_ts(c.updated_at)
    )


def _message(m: MessageRow) -> chat_pb2.ChatMessage:
    return chat_pb2.ChatMessage(
        id=str(m.id),
        role=m.role,
        content=m.content,
        citations=[chat_pb2.Citation(**c) for c in m.citations],
        create_time=_ts(m.created_at),
    )


def _response(event: AnswerEvent) -> chat_pb2.StreamChatResponse:
    match event:
        case SourcesFound(citations):
            return chat_pb2.StreamChatResponse(citations=chat_pb2.Citations(items=citations))
        case AnswerDelta(text):
            return chat_pb2.StreamChatResponse(delta=text)
        case AnswerSaved(message):
            return chat_pb2.StreamChatResponse(message=_message(message))
