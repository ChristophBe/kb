"""The answer use case: retrieve sources, build the prompt, generate, persist."""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from kb.chat.v1 import chat_pb2

from .config import Settings
from .context import ApproximateTokenCounter, TokenCounter, fit
from .repository import MessageRow, Repository

TITLE_LENGTH = 60

SYSTEM_PROMPT = "You are a helpful assistant for a personal knowledge base. Answer concisely."
RAG_PROMPT = (
    "Answer using the numbered sources below when they are relevant and cite them like [1]. "
    "If the sources do not contain the answer, say so.\n\nSources:\n{sources}"
)


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
    unless it is empty. Failures are raised as PeerError."""

    async def retrieve(
        self, query: str, limit: int, document_ids: Sequence[uuid.UUID]
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
        self, conversation_id: uuid.UUID, content: str, model: str, use_knowledge_base: bool
    ) -> AsyncGenerator[AnswerEvent]:
        """Answers a question in a conversation. The question is saved first, so
        it stays in the conversation even when no answer can be generated. When a
        peer fails, the answer so far is saved as failed after an AnswerFailed.
        When the caller goes away (the task is cancelled or the stream closed),
        generation stops and the answer so far is saved as stopped."""
        conv = await self._repo.get_conversation(conversation_id)
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
                    content, self._settings.rag_top_k, conv.document_ids
                )
            budget = self._settings.context_tokens - self._settings.answer_reserve_tokens
            context = fit(budget, self._counter, _system_prompt, retrieved, history, content)
            # Only the sources that made it into the prompt are cited, numbered as there.
            citations = context.sources
            if use_knowledge_base:
                yield SourcesFound(citations)

            prompt = _prompt(citations, context.history, content)
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


def _prompt(
    citations: list[chat_pb2.Citation], history: list[MessageRow], content: str
) -> list[PromptMessage]:
    return [
        PromptMessage(PromptRole.SYSTEM, _system_prompt(citations)),
        *(PromptMessage(_PROMPT_ROLES[m.role], m.content) for m in history),
        PromptMessage(PromptRole.USER, content),
    ]


def _system_prompt(citations: Sequence[chat_pb2.Citation]) -> str:
    if not citations:
        return SYSTEM_PROMPT
    sources = "\n\n".join(
        f"[{i}] {c.document_title}:\n{c.snippet}" for i, c in enumerate(citations, start=1)
    )
    return f"{SYSTEM_PROMPT}\n\n{RAG_PROMPT.format(sources=sources)}"


def _citation_to_dict(c: chat_pb2.Citation) -> dict[str, Any]:
    return {
        "document_id": c.document_id,
        "document_title": c.document_title,
        "chunk_index": c.chunk_index,
        "snippet": c.snippet,
        "score": c.score,
    }
