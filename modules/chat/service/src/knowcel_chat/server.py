import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import datetime
from typing import Any

import grpc
from google.protobuf.timestamp_pb2 import Timestamp
from knowcel.chat.v1 import chat_pb2, chat_pb2_grpc
from knowcel.common.v1 import common_pb2
from knowcel_platform.grpc import (
    abort_invalid_argument,
    current_principal,
    current_user,
    violation,
)
from knowcel_platform.pagination import InvalidCursorError, decode_cursor

from .chat import (
    AnswerDelta,
    AnswerEvent,
    AnswerFailed,
    AnswerSaved,
    Chat,
    Peer,
    PeerError,
    PeerUnavailableError,
    SourcesFound,
)
from .prompts import DEFAULTS, VARIABLES, TemplateError, TemplateName, parse
from .repository import ConversationRow, MessageRow, Repository
from .runner import AlreadyRunningError, AnswerRunner

log = logging.getLogger("knowcel_chat")

_Context = grpc.aio.ServicerContext[Any, Any]

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_TITLE_LENGTH = 200
MAX_SCOPE_DOCUMENTS = 100
MAX_SCOPE_TEAMS = 50
DEFAULT_SEARCH_LIMIT = 20
MAX_SEARCH_LIMIT = 50

# The peers' titles in the UI (their module.yaml), for error messages.
_PEER_TITLES = {Peer.DOCUMENT: "Documents", Peer.LLM: "Models"}


class ChatServicer(chat_pb2_grpc.ChatServiceServicer):
    """Every RPC acts for the calling user (`current_user()`) and sees only the
    conversations they own; another user's conversation is not found."""

    def __init__(self, repo: Repository, chat: Chat) -> None:
        self._repo = repo
        self.runner = AnswerRunner(chat, repo)

    async def CreateConversation(
        self, request: chat_pb2.CreateConversationRequest, context: _Context
    ) -> chat_pb2.CreateConversationResponse:
        owner = await _owner(context)
        document_ids = await _scope(request.document_ids, context)
        team_ids = await _teams(request.team_ids, context)
        conv = await self._repo.create_conversation(owner, request.title, document_ids, team_ids)
        return chat_pb2.CreateConversationResponse(conversation=self._pb(conv))

    async def GetConversation(
        self, request: chat_pb2.GetConversationRequest, context: _Context
    ) -> chat_pb2.GetConversationResponse:
        conv = await self._get(request.id, context)
        msgs = await self._repo.list_messages(conv.id)
        if conv.completed_unseen:
            # Opening the conversation is seeing the answer.
            await self._repo.set_completed_unseen(conv.id, False)
            conv.completed_unseen = False
        return chat_pb2.GetConversationResponse(
            conversation=self._pb(conv), messages=[_message(m) for m in msgs]
        )

    async def ListConversations(
        self, request: chat_pb2.ListConversationsRequest, context: _Context
    ) -> chat_pb2.ListConversationsResponse:
        owner = await _owner(context)
        limit = min(request.page.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        after = None
        if request.page.page_token:
            try:
                after = decode_cursor(request.page.page_token)
            except InvalidCursorError:
                await abort_invalid_argument(
                    context, violation("page.page_token", "The page token is invalid")
                )
        rows = await self._repo.list_conversations(owner, limit + 1, after)
        page = rows[:limit]
        token = page[-1].cursor.encode() if len(rows) > limit else ""
        return chat_pb2.ListConversationsResponse(
            conversations=[self._pb(c) for c in page],
            page=common_pb2.PageResponse(next_page_token=token),
        )

    async def DeleteConversation(
        self, request: chat_pb2.DeleteConversationRequest, context: _Context
    ) -> chat_pb2.DeleteConversationResponse:
        conv = await self._get(request.id, context)
        # An answer would otherwise try to save into the deleted conversation.
        await self.runner.stop(conv.id)
        if not await self._repo.delete_conversation(conv.owner_id, conv.id):
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
        team_ids: list[uuid.UUID] | None = None
        if request.HasField("team_ids"):
            team_ids = await _teams(request.team_ids.ids, context, "team_ids.ids")
        system_prompt: str | None = None
        if request.HasField("system_prompt"):
            system_prompt = request.system_prompt.strip()
            await _check_template(context, "system_prompt", system_prompt)
        if any(v is not None for v in (title, document_ids, team_ids, system_prompt)):
            updated = await self._repo.update_conversation(
                conv.owner_id,
                conv.id,
                title=title,
                document_ids=document_ids,
                team_ids=team_ids,
                system_prompt=system_prompt,
            )
            if updated is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
            assert updated is not None
            conv = updated
        return chat_pb2.UpdateConversationResponse(conversation=self._pb(conv))

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
                chat_pb2.ConversationMatch(conversation=self._pb(m.conversation), snippet=m.snippet)
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
        conv = await self._get(request.conversation_id, context)
        # The document and llm modules are soft dependencies: when one fails, the
        # stream ends with an error event and the answer so far, not a gRPC error.
        # The answer is written in the background: when the client goes away
        # (a closed tab, leaving the page), only following it ends. StopChat
        # stops it.
        try:
            run = self.runner.start(
                owner,
                conv.id,
                content,
                request.model,
                request.use_knowledge_base,
                _member_teams(),
            )
        except AlreadyRunningError:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                "an answer is already being written in this conversation",
            )
        queue = run.follow()
        async with contextlib.aclosing(run.events(queue)) as events:
            try:
                async for event in events:
                    yield _response(event)
            except (asyncio.CancelledError, GeneratorExit):
                log.info("client stopped following the answer in conversation %s", conv.id)
                raise

    async def StopChat(
        self, request: chat_pb2.StopChatRequest, context: _Context
    ) -> chat_pb2.StopChatResponse:
        conv = await self._get(request.conversation_id, context)
        await self.runner.stop(conv.id)
        return chat_pb2.StopChatResponse()

    async def GetPromptTemplates(
        self, request: chat_pb2.GetPromptTemplatesRequest, context: _Context
    ) -> chat_pb2.GetPromptTemplatesResponse:
        await _owner(context)
        return chat_pb2.GetPromptTemplatesResponse(
            templates=_templates(await self._repo.get_prompt_templates())
        )

    async def UpdatePromptTemplates(
        self, request: chat_pb2.UpdatePromptTemplatesRequest, context: _Context
    ) -> chat_pb2.UpdatePromptTemplatesResponse:
        await _require_platform_admin(context)
        changes: dict[str, str] = {}
        for field, name, required in (
            ("system_prompt", TemplateName.SYSTEM, ()),
            ("sources_template", TemplateName.SOURCES, ("sources",)),
            ("no_sources_template", TemplateName.NO_SOURCES, ()),
        ):
            if request.HasField(field):
                text = getattr(request, field).strip()
                await _check_template(context, field, text, required)
                changes[name] = text
        if changes:
            await self._repo.set_prompt_templates(changes)
        return chat_pb2.UpdatePromptTemplatesResponse(
            templates=_templates(await self._repo.get_prompt_templates())
        )

    async def shutdown(self) -> None:
        """Stops the answers being written, saving what they have."""
        await self.runner.shutdown()

    def _pb(self, c: ConversationRow) -> chat_pb2.Conversation:
        return _conversation(c, generating=self.runner.is_running(c.id))

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


async def _require_platform_admin(context: _Context) -> None:
    """Rejects callers who are not platform admins. Fails closed: without a
    caller, or while iam can't say who they are, nobody is an admin."""
    principal = current_principal()
    if principal is None or not principal.platform_admin:
        await context.abort(
            grpc.StatusCode.PERMISSION_DENIED, "only platform admins can change the default prompts"
        )


async def _check_template(
    context: _Context, field: str, text: str, required: tuple[str, ...] = ()
) -> None:
    """Rejects an invalid template with the reason in the violation of `field`;
    empty means the default and is always valid."""
    if not text:
        return
    try:
        parse(text, required)
    except TemplateError as err:
        await abort_invalid_argument(context, violation(field, str(err)))


def _templates(changed: dict[str, str]) -> chat_pb2.PromptTemplates:
    def one(name: TemplateName) -> chat_pb2.PromptTemplate:
        content = changed.get(name, "")
        return chat_pb2.PromptTemplate(
            content=content or DEFAULTS[name],
            default_content=DEFAULTS[name],
            is_default=not content,
        )

    return chat_pb2.PromptTemplates(
        system_prompt=one(TemplateName.SYSTEM),
        sources_template=one(TemplateName.SOURCES),
        no_sources_template=one(TemplateName.NO_SOURCES),
        variables=list(VARIABLES),
    )


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


async def _teams(raw: Sequence[str], context: _Context, field: str = "team_ids") -> list[uuid.UUID]:
    """Parses a team scope, the request field named `field`: duplicates are
    dropped, the order is kept, and the caller must belong to each team
    (PERMISSION_DENIED otherwise). While the caller's teams are unknown, a
    scope can't be checked and is refused with UNAVAILABLE."""
    ids: list[uuid.UUID] = []
    for i, value in enumerate(raw):
        try:
            parsed = uuid.UUID(value)
        except ValueError:
            await abort_invalid_argument(
                context, violation(f"{field}[{i}]", f"Invalid team id {value!r}")
            )
        if parsed not in ids:
            ids.append(parsed)
    if len(ids) > MAX_SCOPE_TEAMS:
        await abort_invalid_argument(
            context,
            violation(field, f"A conversation can be limited to at most {MAX_SCOPE_TEAMS} teams"),
        )
    if not ids:
        return ids
    member = _member_teams()
    if member is None:
        await context.abort(grpc.StatusCode.UNAVAILABLE, "your teams are unavailable right now")
    assert member is not None
    if any(t not in member for t in ids):
        await context.abort(
            grpc.StatusCode.PERMISSION_DENIED, "you are not a member of one of the teams"
        )
    return ids


def _member_teams() -> list[uuid.UUID] | None:
    """The teams the calling user belongs to; None while they are not known
    (iam is down, or the server has no resolver)."""
    principal = current_principal()
    if principal is None or principal.unavailable:
        return None
    member: list[uuid.UUID] = []
    for team_id in principal.team_ids:
        with contextlib.suppress(ValueError):
            member.append(uuid.UUID(team_id))
    return member


def _ts(value: datetime) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def _conversation(c: ConversationRow, generating: bool = False) -> chat_pb2.Conversation:
    return chat_pb2.Conversation(
        id=str(c.id),
        title=c.title,
        create_time=_ts(c.created_at),
        update_time=_ts(c.updated_at),
        document_ids=[str(i) for i in c.document_ids],
        team_ids=[str(i) for i in c.team_ids],
        last_message_time=_ts(c.last_message_time) if c.last_message_time else None,
        last_message_preview=c.last_message_preview,
        owner_id=c.owner_id,
        generating=generating,
        completed_unseen=c.completed_unseen,
        system_prompt=c.system_prompt,
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
