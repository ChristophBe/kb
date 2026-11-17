"""The answer use case: retrieve sources, build the prompt, generate, persist."""

import asyncio
import contextlib
import functools
import logging
import uuid
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from knowcel.chat.v1 import chat_pb2

from .config import Settings
from .context import ApproximateTokenCounter, SystemPrompt, TokenCounter, fit
from .prompts import DEFAULTS, Template, TemplateError, TemplateName, parse
from .repository import ConversationRow, MessageRow, Repository

log = logging.getLogger("knowcel_chat")

TITLE_LENGTH = 60


class ConversationNotFoundError(Exception):
    """The conversation does not exist."""


class Peer(StrEnum):
    """The modules the answer use case depends on."""

    DOCUMENT = "document"
    LLM = "llm"


class PeerError(Exception):
    """A peer module failed. The message is logged, never sent to callers."""

    def __init__(self, peer: Peer, message: str) -> None:
        super().__init__(f"{peer}: {message}")
        self.peer = peer


class PeerUnavailableError(PeerError):
    """A peer module cannot be reached right now; try again later."""


class PromptRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


@dataclass(frozen=True)
class PromptMessage:
    role: PromptRole
    content: str


class Retriever(Protocol):
    """Finds the passages most relevant to a question, only in `document_ids`
    and only in documents of `team_ids`, each unless empty. Failures are raised
    as PeerError."""

    async def retrieve(
        self,
        query: str,
        limit: int,
        document_ids: Sequence[uuid.UUID],
        team_ids: Sequence[uuid.UUID] = (),
    ) -> list[chat_pb2.Citation]: ...


class Generator(Protocol):
    """Streams the text of an answer. Failures are raised as PeerError. Closing
    the stream early (or cancelling the task reading it) stops the generation."""

    def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncGenerator[str]: ...


@dataclass(frozen=True)
class SourcesFound:
    citations: list[chat_pb2.Citation]


@dataclass(frozen=True)
class AnswerDelta:
    text: str


@dataclass(frozen=True)
class AnswerFailed:
    """A peer failed; the answer so far follows as a failed AnswerSaved."""

    error: PeerError


@dataclass(frozen=True)
class AnswerSaved:
    message: MessageRow


AnswerEvent = SourcesFound | AnswerDelta | AnswerFailed | AnswerSaved

_PROMPT_ROLES = {
    chat_pb2.MESSAGE_ROLE_USER: PromptRole.USER,
    chat_pb2.MESSAGE_ROLE_ASSISTANT: PromptRole.ASSISTANT,
}


def _current_teams(
    chosen: Sequence[uuid.UUID], member: Sequence[uuid.UUID] | None
) -> list[uuid.UUID]:
    """The chosen teams that still count: a team that was deleted or that the
    user has left is dropped, and none left means all documents. While the
    user's teams are not known, the choice stands; the document module still
    shows only what the user may read."""
    if member is None:
        return list(chosen)
    return [t for t in chosen if t in member]


class Chat:
    def __init__(
        self,
        settings: Settings,
        repo: Repository,
        retriever: Retriever,
        generator: Generator,
        counter: TokenCounter | None = None,
    ) -> None:
        self._settings = settings
        self._repo = repo
        self._retriever = retriever
        self._generator = generator
        self._counter = counter or ApproximateTokenCounter()

    async def answer(
        self,
        owner: str,
        conversation_id: uuid.UUID,
        content: str,
        model: str,
        use_knowledge_base: bool,
        member_team_ids: Sequence[uuid.UUID] | None = None,
    ) -> AsyncGenerator[AnswerEvent]:
        """Answers a question in a conversation. The question is saved first, so
        it stays in the conversation even when no answer can be generated. When a
        peer fails, the answer so far is saved as failed after an AnswerFailed.
        When the caller goes away (the task is cancelled or the stream closed),
        generation stops and the answer so far is saved as stopped. Another
        owner's conversation is not found. `member_team_ids` are the teams the
        owner belongs to now (None if that is not known): the conversation's
        teams are cut down to them, and with none left it uses all documents."""
        conv = await self._repo.get_conversation(owner, conversation_id)
        if conv is None:
            raise ConversationNotFoundError(str(conversation_id))
        history = await self._repo.list_messages(conv.id, self._settings.history_limit)
        # A failed answer is cut off or empty, a stopped one may be empty; the
        # model is better off without them.
        history = [m for m in history if m.status != chat_pb2.MESSAGE_STATUS_FAILED and m.content]
        await self._repo.add_message(conv.id, chat_pb2.MESSAGE_ROLE_USER, content, [])
        if not conv.title:
            await self._repo.set_title(conv.id, content[:TITLE_LENGTH])

        answer: list[str] = []
        citations: list[chat_pb2.Citation] = []
        status = chat_pb2.MESSAGE_STATUS_COMPLETE
        try:
            retrieved: list[chat_pb2.Citation] = []
            if use_knowledge_base:
                retrieved = await self._retriever.retrieve(
                    content,
                    self._settings.rag_top_k,
                    conv.document_ids,
                    _current_teams(conv.team_ids, member_team_ids),
                )
            budget = self._settings.context_tokens - self._settings.answer_reserve_tokens
            prompts = await self._prompts(conv)
            system_prompt = prompts.system_for(use_knowledge_base)
            context = fit(
                budget,
                self._counter,
                system_prompt,
                retrieved,
                history,
                content,
                history_in_prompt=prompts.history_in_prompt,
            )
            # Only the sources that made it into the prompt are cited, numbered as there.
            citations = context.sources
            if use_knowledge_base:
                yield SourcesFound(citations)

            prompt = _prompt(
                system_prompt(citations, context.history),
                [] if prompts.history_in_prompt else context.history,
                content,
            )
            async with contextlib.aclosing(self._generator.generate(model, prompt)) as deltas:
                async for delta in deltas:
                    answer.append(delta)
                    yield AnswerDelta(delta)
        except PeerError as err:
            status = chat_pb2.MESSAGE_STATUS_FAILED
            yield AnswerFailed(err)
        except (asyncio.CancelledError, GeneratorExit):
            # The caller stopped the answer or went away (a closed tab): leaving
            # the generator stream has cancelled the generation. Keep the text so
            # far; shielded, so a repeated cancel can't lose it halfway.
            await asyncio.shield(
                self._save(conv.id, answer, citations, chat_pb2.MESSAGE_STATUS_STOPPED)
            )
            raise

        yield AnswerSaved(await asyncio.shield(self._save(conv.id, answer, citations, status)))

    async def _prompts(self, conv: ConversationRow) -> "_Prompts":
        """The templates for an answer in `conv`: its own system prompt, else the
        admins' default, else the built-in one."""
        overrides = await self._repo.get_prompt_templates()
        return _Prompts(
            system=_template(
                conv.system_prompt or overrides.get(TemplateName.SYSTEM, ""), TemplateName.SYSTEM
            ),
            sources=_template(overrides.get(TemplateName.SOURCES, ""), TemplateName.SOURCES),
            no_sources=_template(
                overrides.get(TemplateName.NO_SOURCES, ""), TemplateName.NO_SOURCES
            ),
        )

    async def _save(
        self,
        conversation_id: uuid.UUID,
        answer: list[str],
        citations: list[chat_pb2.Citation],
        status: chat_pb2.MessageStatus,
    ) -> MessageRow:
        return await self._repo.add_message(
            conversation_id,
            chat_pb2.MESSAGE_ROLE_ASSISTANT,
            "".join(answer),
            [_citation_to_dict(c) for c in citations],
            status,
        )


def _prompt(system: str, history: list[MessageRow], content: str) -> list[PromptMessage]:
    return [
        PromptMessage(PromptRole.SYSTEM, system),
        *(PromptMessage(_PROMPT_ROLES[m.role], m.content) for m in history),
        PromptMessage(PromptRole.USER, content),
    ]


def _template(text: str, name: TemplateName) -> Template:
    """The parsed template; the built-in one when `text` is empty or, which
    validation on save should prevent, invalid."""
    if text:
        try:
            return parse(text)
        except TemplateError as err:
            log.error("the %s prompt template is invalid, using the built-in one: %s", name, err)
    return parse(DEFAULTS[name])


@dataclass(frozen=True)
class _Prompts:
    system: Template
    sources: Template
    no_sources: Template

    @property
    def history_in_prompt(self) -> bool:
        """Whether a template shows the history, which is then not sent again as
        messages."""
        return any("history" in t.variables for t in (self.system, self.sources, self.no_sources))

    def system_message(
        self,
        use_knowledge_base: bool,
        citations: Sequence[chat_pb2.Citation],
        history: Sequence[MessageRow],
    ) -> str:
        values = {"sources": _sources(citations), "history": _transcript(history)}
        parts = [self.system.render(values)]
        if citations and "sources" not in self.system.variables:
            parts.append(self.sources.render(values))
        elif not citations and use_knowledge_base:
            # Asked to use the knowledge base, but no passage was related enough.
            parts.append(self.no_sources.render(values))
        return "\n\n".join(p for p in parts if p)

    def system_for(self, use_knowledge_base: bool) -> SystemPrompt:
        return functools.partial(self.system_message, use_knowledge_base)


def _sources(citations: Sequence[chat_pb2.Citation]) -> str:
    return "\n\n".join(
        f"[{i}] {_source_name(c)}:\n{c.snippet}" for i, c in enumerate(citations, start=1)
    )


def _transcript(history: Sequence[MessageRow]) -> str:
    names = {chat_pb2.MESSAGE_ROLE_USER: "User", chat_pb2.MESSAGE_ROLE_ASSISTANT: "Assistant"}
    return "\n\n".join(f"{names[m.role]}: {m.content}" for m in history)


def _source_name(c: chat_pb2.Citation) -> str:
    # Tells the model that a source explains the tool, not the user's documents.
    return f"User manual, {c.document_title}" if c.manual_page else c.document_title


def _citation_to_dict(c: chat_pb2.Citation) -> dict[str, Any]:
    return {
        "document_id": c.document_id,
        "document_title": c.document_title,
        "chunk_index": c.chunk_index,
        "snippet": c.snippet,
        "score": c.score,
        "manual_page": c.manual_page,
        "manual_section": c.manual_section,
    }
