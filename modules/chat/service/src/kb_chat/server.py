import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import datetime
from typing import Any

import grpc
from google.protobuf.timestamp_pb2 import Timestamp
from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.common.v1 import common_pb2
from kb_platform.grpc import abort_invalid_argument, current_user, violation

from .chat import (
    AnswerDelta,
    AnswerEvent,
    AnswerFailed,
    AnswerSaved,
    Chat,
    ConversationNotFoundError,
    Peer,
    PeerError,
    PeerUnavailableError,
    SourcesFound,
)
from .repository import ConversationRow, MessageRow, Repository

log = logging.getLogger("kb_chat")

_Context = grpc.aio.ServicerContext[Any, Any]

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_TITLE_LENGTH = 200
MAX_SCOPE_DOCUMENTS = 100
DEFAULT_SEARCH_LIMIT = 20
MAX_SEARCH_LIMIT = 50

# The peers' titles in the UI (their module.yaml), for error messages.
_PEER_TITLES = {Peer.DOCUMENT: "Documents", Peer.LLM: "Models"}


class ChatServicer(chat_pb2_grpc.ChatServiceServicer):
    """Every RPC acts for the calling user (`current_user()`) and sees only the
    conversations they own; another user's conversation is not found."""

    def __init__(self, repo: Repository, chat: Chat) -> None:
        self._repo = repo
        self._chat = chat

    async def CreateConversation(
        self, request: chat_pb2.CreateConversationRequest, context: _Context
    ) -> chat_pb2.CreateConversationResponse:
        owner = await _owner(context)
        document_ids = await _scope(request.document_ids, context)
        conv = await self._repo.create_conversation(owner, request.title, document_ids)
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
        owner = await _owner(context)
        limit = min(request.page.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        try:
            offset = int(request.page.page_token or 0)
        except ValueError:
            await abort_invalid_argument(
                context, violation("page.page_token", "The page token is invalid")
            )
        rows = await self._repo.list_conversations(owner, limit + 1, offset)
        token = str(offset + limit) if len(rows) > limit else ""
        return chat_pb2.ListConversationsResponse(
            conversations=[_conversation(c) for c in rows[:limit]],
            page=common_pb2.PageResponse(next_page_token=token),
        )

    async def DeleteConversation(
        self, request: chat_pb2.DeleteConversationRequest, context: _Context
    ) -> chat_pb2.DeleteConversationResponse:
        owner = await _owner(context)
        if not await self._repo.delete_conversation(owner, _parse_id(request.id)):
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        return chat_pb2.DeleteConversationResponse()

    async def UpdateConversation(
        self, request: chat_pb2.UpdateConversationRequest, context: _Context
    ) -> chat_pb2.UpdateConversationResponse:
        conv = await self._get(request.id, context)
        title: str | None = None
        if request.HasField("title"):
            title = request.title.strip()
            if not title:
                await abort_invalid_argument(context, violation("title", "Title must not be empty"))
            if len(title) > MAX_TITLE_LENGTH:
                await abort_invalid_argument(
                    context,
                    violation(
                        "title", f"Title must not be longer than {MAX_TITLE_LENGTH} characters"
                    ),
                )
        document_ids: list[uuid.UUID] | None = None
        if request.HasField("document_ids"):
            document_ids = await _scope(request.document_ids.ids, context, "document_ids.ids")
        if title is not None or document_ids is not None:
            updated = await self._repo.update_conversation(
                conv.owner_id, conv.id, title=title, document_ids=document_ids
            )
            if updated is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
            assert updated is not None
            conv = updated
        return chat_pb2.UpdateConversationResponse(conversation=_conversation(conv))

    async def SearchConversations(
        self, request: chat_pb2.SearchConversationsRequest, context: _Context
    ) -> chat_pb2.SearchConversationsResponse:
        owner = await _owner(context)
        query = request.query.strip()
        if not query:
            await abort_invalid_argument(context, violation("query", "Enter a search term"))
        if request.limit < 0:
            await abort_invalid_argument(
                context, violation("limit", "The limit must not be negative")
            )
        limit = min(request.limit or DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
        matches = await self._repo.search_conversations(owner, query, limit)
        return chat_pb2.SearchConversationsResponse(
            results=[
                chat_pb2.ConversationMatch(
                    conversation=_conversation(m.conversation), snippet=m.snippet
                )
                for m in matches
            ]
        )

    async def StreamChat(
        self, request: chat_pb2.StreamChatRequest, context: _Context
    ) -> AsyncIterator[chat_pb2.StreamChatResponse]:
        owner = await _owner(context)
        content = request.content.strip()
        if not content:
            await abort_invalid_argument(
                context, violation("content", "The message must not be empty")
            )
        events = self._chat.answer(
            owner,
            _parse_id(request.conversation_id),
            content,
            request.model,
            request.use_knowledge_base,
        )
        # The document and llm modules are soft dependencies: when one fails, the
        # stream ends with an error event and the answer so far, not a gRPC error.
        # When the client cancels (Stop, a closed tab), gRPC cancels this task or
        # closes this generator; closing `events` stops the generation and saves
        # the answer so far as stopped.
        async with contextlib.aclosing(events):
            try:
                async for event in events:
                    yield _response(event)
            except ConversationNotFoundError:
                await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
            except (asyncio.CancelledError, GeneratorExit):
                log.info(
                    "StreamChat cancelled by the client in conversation %s", request.conversation_id
                )
                raise

    async def _get(self, raw_id: str, context: _Context) -> ConversationRow:
        owner = await _owner(context)
        conv = await self._repo.get_conversation(owner, _parse_id(raw_id))
        if conv is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        assert conv is not None
        return conv


async def _owner(context: _Context) -> str:
    """The calling user; calls without one (not through the gateway) are
    rejected."""
    user = current_user()
    if user is None:
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, "no user in the call")
    assert user is not None
    return user


def _parse_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        # Unknown ids and malformed ids are both "not found" for callers.
        return uuid.UUID(int=0)


async def _scope(
    raw: Sequence[str], context: _Context, field: str = "document_ids"
) -> list[uuid.UUID]:
    """Parses a document scope, the request field named `field`; duplicates are
    dropped, the order is kept."""
    ids: list[uuid.UUID] = []
    for i, value in enumerate(raw):
        try:
            parsed = uuid.UUID(value)
        except ValueError:
            await abort_invalid_argument(
                context, violation(f"{field}[{i}]", f"Invalid document id {value!r}")
            )
        if parsed not in ids:
            ids.append(parsed)
    if len(ids) > MAX_SCOPE_DOCUMENTS:
        await abort_invalid_argument(
            context,
            violation(
                field,
                f"A conversation can be limited to at most {MAX_SCOPE_DOCUMENTS} documents",
            ),
        )
    return ids


def _ts(value: datetime) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def _conversation(c: ConversationRow) -> chat_pb2.Conversation:
    return chat_pb2.Conversation(
        id=str(c.id),
        title=c.title,
        create_time=_ts(c.created_at),
        update_time=_ts(c.updated_at),
        document_ids=[str(i) for i in c.document_ids],
        last_message_time=_ts(c.last_message_time) if c.last_message_time else None,
        last_message_preview=c.last_message_preview,
        owner_id=c.owner_id,
    )


def _message(m: MessageRow) -> chat_pb2.ChatMessage:
    return chat_pb2.ChatMessage(
        id=str(m.id),
        role=m.role,
        content=m.content,
        citations=[chat_pb2.Citation(**c) for c in m.citations],
        create_time=_ts(m.created_at),
        status=m.status,
    )


def _response(event: AnswerEvent) -> chat_pb2.StreamChatResponse:
    match event:
        case SourcesFound(citations):
            return chat_pb2.StreamChatResponse(citations=chat_pb2.Citations(items=citations))
        case AnswerDelta(text):
            return chat_pb2.StreamChatResponse(delta=text)
        case AnswerFailed(error):
            return chat_pb2.StreamChatResponse(error=_error(error))
        case AnswerSaved(message):
            return chat_pb2.StreamChatResponse(message=_message(message))


def _error(err: PeerError) -> chat_pb2.ChatError:
    title = _PEER_TITLES[err.peer]
    if isinstance(err, PeerUnavailableError):
        log.warning("peer unavailable: %s", err)
        return chat_pb2.ChatError(
            code=chat_pb2.CHAT_ERROR_CODE_UNAVAILABLE,
            message=f"The {title} service isn't available. Try again in a moment.",
        )
    log.error("peer call failed: %s", err)
    return chat_pb2.ChatError(
        code=chat_pb2.CHAT_ERROR_CODE_INTERNAL,
        message=f"The {title} service couldn't complete the answer.",
    )
