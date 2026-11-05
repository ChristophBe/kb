import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from typing import Any

import grpc
import pytest
from kb.chat.v1 import chat_pb2
from kb_chat.chat import (
    RAG_PROMPT,
    SYSTEM_PROMPT,
    TITLE_LENGTH,
    AnswerDelta,
    AnswerEvent,
    AnswerFailed,
    AnswerSaved,
    Chat,
    ConversationNotFoundError,
    Peer,
    PeerError,
    PeerUnavailableError,
    PromptMessage,
    PromptRole,
    SourcesFound,
)
from kb_chat.config import Settings
from kb_chat.peers import PeerGenerator, PeerRetriever
from kb_chat.repository import ConversationRow, MessageRow

USER = chat_pb2.MESSAGE_ROLE_USER
ASSISTANT = chat_pb2.MESSAGE_ROLE_ASSISTANT
COMPLETE = chat_pb2.MESSAGE_STATUS_COMPLETE
FAILED = chat_pb2.MESSAGE_STATUS_FAILED


class FakeRepo:
    def __init__(self, title: str = "") -> None:
        now = datetime.now(UTC)
        self.conv = ConversationRow(uuid.uuid4(), title, now, now)
        self.messages: list[MessageRow] = []

    async def get_conversation(self, id: uuid.UUID) -> ConversationRow | None:
        return self.conv if id == self.conv.id else None

    async def set_title(self, id: uuid.UUID, title: str) -> None:
        self.conv.title = title

    async def list_messages(
        self, conversation_id: uuid.UUID, limit: int | None = None
    ) -> list[MessageRow]:
        return self.messages[-limit:] if limit else list(self.messages)

    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
        status: chat_pb2.MessageStatus = COMPLETE,
    ) -> MessageRow:
        msg = MessageRow(
            uuid.uuid4(), conversation_id, role, content, datetime.now(UTC), citations, status
        )
        self.messages.append(msg)
        return msg


class FakeRetriever:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[str, int, list[uuid.UUID]]] = []

    async def retrieve(
        self, query: str, limit: int, document_ids: Sequence[uuid.UUID]
    ) -> list[chat_pb2.Citation]:
        self.calls.append((query, limit, list(document_ids)))
        if self.error:
            raise self.error
        return [
            chat_pb2.Citation(
                document_id="d1", document_title="geo.md", chunk_index=2, snippet="Paris", score=0.9
            )
        ]


class FakeGenerator:
    def __init__(self, deltas: tuple[str, ...] = ("Par", "is"), error: Exception | None = None):
        self.deltas = deltas
        self.error = error
        self.calls: list[tuple[str, list[PromptMessage]]] = []

    async def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncIterator[str]:
        self.calls.append((model, prompt))
        for delta in self.deltas:
            yield delta
        if self.error:
            raise self.error


def make(
    repo: FakeRepo | None = None,
    retriever: FakeRetriever | None = None,
    generator: FakeGenerator | None = None,
    **settings: Any,
) -> tuple[Chat, FakeRepo, FakeRetriever, FakeGenerator]:
    repo = repo or FakeRepo()
    retriever = retriever or FakeRetriever()
    generator = generator or FakeGenerator()
    port: Any = repo  # FakeRepo implements only what the use case calls
    return Chat(Settings(**settings), port, retriever, generator), repo, retriever, generator


async def collect(chat: Chat, repo: FakeRepo, use_kb: bool = True) -> list[AnswerEvent]:
    return [e async for e in chat.answer(repo.conv.id, "Capital?", "m1", use_kb)]


async def test_answer_streams_sources_then_deltas_then_the_saved_message() -> None:
    chat, repo, retriever, generator = make(rag_top_k=3)
    events = await collect(chat, repo)

    assert isinstance(events[0], SourcesFound)
    assert events[1:3] == [AnswerDelta("Par"), AnswerDelta("is")]
    assert isinstance(events[3], AnswerSaved)
    assert events[3].message.content == "Paris"
    assert events[3].message.citations == [
        {
            "document_id": "d1",
            "document_title": "geo.md",
            "chunk_index": 2,
            "snippet": "Paris",
            "score": pytest.approx(0.9),
        }
    ]
    assert retriever.calls == [("Capital?", 3, [])]
    assert generator.calls[0][0] == "m1"
    assert [(m.role, m.content, m.status) for m in repo.messages] == [
        (USER, "Capital?", COMPLETE),
        (ASSISTANT, "Paris", COMPLETE),
    ]


async def test_retrieval_is_limited_to_the_conversation_scope() -> None:
    scope = [uuid.uuid4(), uuid.uuid4()]
    repo = FakeRepo()
    repo.conv.document_ids = scope
    chat, repo, retriever, _ = make(repo, rag_top_k=3)
    await collect(chat, repo)
    assert retriever.calls == [("Capital?", 3, scope)]


async def test_without_the_knowledge_base_nothing_is_retrieved() -> None:
    chat, repo, retriever, generator = make()
    events = await collect(chat, repo, use_kb=False)

    assert retriever.calls == []
    assert not any(isinstance(e, SourcesFound) for e in events)
    system = generator.calls[0][1][0]
    assert system == PromptMessage(PromptRole.SYSTEM, SYSTEM_PROMPT)


async def test_prompt_numbers_sources_and_keeps_the_history_in_order() -> None:
    repo = FakeRepo()
    await repo.add_message(repo.conv.id, USER, "earlier", [])
    await repo.add_message(repo.conv.id, ASSISTANT, "reply", [])
    chat, repo, _, generator = make(repo)
    await collect(chat, repo)

    system, *rest = generator.calls[0][1]
    assert system.content == (
        f"{SYSTEM_PROMPT}\n\n{RAG_PROMPT.format(sources='[1] geo.md:\nParis')}"
    )
    assert rest == [
        PromptMessage(PromptRole.USER, "earlier"),
        PromptMessage(PromptRole.ASSISTANT, "reply"),
        PromptMessage(PromptRole.USER, "Capital?"),
    ]


async def test_history_is_limited_and_excludes_the_new_question() -> None:
    repo = FakeRepo()
    for i in range(4):
        await repo.add_message(repo.conv.id, USER, f"q{i}", [])
    chat, repo, _, generator = make(repo, history_limit=2)
    await collect(chat, repo)

    assert [m.content for m in generator.calls[0][1][1:]] == ["q2", "q3", "Capital?"]


async def test_the_first_question_sets_the_title() -> None:
    chat, repo, _, _ = make()
    long_question = "x" * (TITLE_LENGTH + 10)
    _ = [e async for e in chat.answer(repo.conv.id, long_question, "", False)]
    assert repo.conv.title == "x" * TITLE_LENGTH


async def test_an_existing_title_is_kept() -> None:
    chat, repo, _, _ = make(FakeRepo(title="Mine"))
    await collect(chat, repo)
    assert repo.conv.title == "Mine"


async def test_unknown_conversation_raises_and_saves_nothing() -> None:
    chat, repo, _, _ = make()
    with pytest.raises(ConversationNotFoundError):
        _ = [e async for e in chat.answer(uuid.uuid4(), "Hi", "", True)]
    assert repo.messages == []


@pytest.mark.parametrize(
    "error", [PeerUnavailableError(Peer.DOCUMENT, "down"), PeerError(Peer.LLM, "boom")]
)
async def test_a_failed_retrieval_saves_an_empty_failed_answer(error: PeerError) -> None:
    chat, repo, _, generator = make(retriever=FakeRetriever(error))
    events = await collect(chat, repo)

    assert events[0] == AnswerFailed(error)
    assert isinstance(events[1], AnswerSaved)
    assert [(m.role, m.content, m.status) for m in repo.messages] == [
        (USER, "Capital?", COMPLETE),
        (ASSISTANT, "", FAILED),
    ]
    assert generator.calls == []


async def test_a_failure_while_generating_keeps_the_partial_answer() -> None:
    error = PeerUnavailableError(Peer.LLM, "down")
    chat, repo, _, _ = make(generator=FakeGenerator(("Par",), error=error))
    events = await collect(chat, repo)

    assert isinstance(events[0], SourcesFound)
    assert events[1:3] == [AnswerDelta("Par"), AnswerFailed(error)]
    saved = events[3]
    assert isinstance(saved, AnswerSaved)
    assert (saved.message.content, saved.message.status) == ("Par", FAILED)
    assert saved.message.citations[0]["document_id"] == "d1"
    assert [(m.role, m.status) for m in repo.messages] == [(USER, COMPLETE), (ASSISTANT, FAILED)]


async def test_failed_answers_are_left_out_of_the_prompt() -> None:
    repo = FakeRepo()
    await repo.add_message(repo.conv.id, USER, "earlier", [])
    await repo.add_message(repo.conv.id, ASSISTANT, "cut o", [], FAILED)
    chat, repo, _, generator = make(repo)
    await collect(chat, repo, use_kb=False)

    assert [m.content for m in generator.calls[0][1][1:]] == ["earlier", "Capital?"]


def rpc_error(code: grpc.StatusCode) -> grpc.aio.AioRpcError:
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "detail")


class FailingLlm:
    def __init__(self, code: grpc.StatusCode) -> None:
        self.code = code

    async def Embed(self, request: Any) -> Any:
        raise rpc_error(self.code)

    async def _gen(self) -> AsyncIterator[Any]:
        raise rpc_error(self.code)
        yield

    def Generate(self, request: Any) -> AsyncIterator[Any]:
        return self._gen()


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        (grpc.StatusCode.UNAVAILABLE, PeerUnavailableError),
        (grpc.StatusCode.DEADLINE_EXCEEDED, PeerUnavailableError),
        (grpc.StatusCode.INTERNAL, PeerError),
        (grpc.StatusCode.RESOURCE_EXHAUSTED, PeerError),
    ],
)
async def test_peer_statuses_become_application_errors(
    code: grpc.StatusCode, expected: type[PeerError]
) -> None:
    llm: Any = FailingLlm(code)
    with pytest.raises(PeerError) as retrieved:
        await PeerRetriever(None, llm).retrieve("q", 1, [])  # type: ignore[arg-type]
    with pytest.raises(PeerError) as generated:
        _ = [d async for d in PeerGenerator(llm).generate("m", [])]
    assert type(retrieved.value) is expected
    assert type(generated.value) is expected
    assert retrieved.value.peer == generated.value.peer == Peer.LLM


class WordCounter:
    def count(self, text: str) -> int:
        return len(text.split())


async def test_only_the_sources_that_fit_are_cited() -> None:
    class TwoSources(FakeRetriever):
        async def retrieve(
            self, query: str, limit: int, document_ids: Sequence[uuid.UUID]
        ) -> list[chat_pb2.Citation]:
            return [
                chat_pb2.Citation(document_id="best", snippet="best " * 5, score=0.9),
                chat_pb2.Citation(document_id="worse", snippet="worse " * 500, score=0.4),
            ]

    repo, retriever, generator = FakeRepo(), TwoSources(), FakeGenerator()
    port: Any = repo
    settings = Settings(context_tokens=300, answer_reserve_tokens=100)
    chat = Chat(settings, port, retriever, generator, WordCounter())

    events = await collect(chat, repo)

    found = events[0]
    assert isinstance(found, SourcesFound)
    assert [c.document_id for c in found.citations] == ["best"]
    system = generator.calls[0][1][0].content
    assert "[1] " in system
    assert "[2] " not in system
    saved = events[-1]
    assert isinstance(saved, AnswerSaved)
    assert [c["document_id"] for c in saved.message.citations] == ["best"]
