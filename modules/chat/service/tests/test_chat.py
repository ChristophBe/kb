import asyncio
import uuid
from collections.abc import AsyncGenerator, AsyncIterator, Sequence
from datetime import UTC, datetime
from typing import Any

import grpc
import pytest
from kb.chat.v1 import chat_pb2
from kb_chat.chat import (
    NO_SOURCES_PROMPT,
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
STOPPED = chat_pb2.MESSAGE_STATUS_STOPPED


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
    def __init__(
        self, error: Exception | None = None, results: list[chat_pb2.Citation] | None = None
    ) -> None:
        self.error = error
        self.results = results
        self.calls: list[tuple[str, int, list[uuid.UUID]]] = []

    async def retrieve(
        self, query: str, limit: int, document_ids: Sequence[uuid.UUID]
    ) -> list[chat_pb2.Citation]:
        self.calls.append((query, limit, list(document_ids)))
        if self.error:
            raise self.error
        if self.results is not None:
            return self.results
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

    async def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncGenerator[str]:
        self.calls.append((model, prompt))
        for delta in self.deltas:
            yield delta
        if self.error:
            raise self.error


class HangingGenerator(FakeGenerator):
    """Streams its deltas, then waits for a token that never comes."""

    def __init__(self, deltas: tuple[str, ...] = ("Par",)) -> None:
        super().__init__(deltas)
        self.waiting = asyncio.Event()
        self.closed = False

    async def generate(self, model: str, prompt: list[PromptMessage]) -> AsyncGenerator[str]:
        try:
            async for delta in super().generate(model, prompt):
                yield delta
            self.waiting.set()
            await asyncio.Event().wait()
        finally:
            self.closed = True


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
            "manual_page": "",
            "manual_section": "",
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


async def test_without_related_passages_the_answer_has_no_sources() -> None:
    chat, repo, _, generator = make(retriever=FakeRetriever(results=[]))
    events = await collect(chat, repo)

    assert events[0] == SourcesFound([])
    system = generator.calls[0][1][0]
    assert system == PromptMessage(PromptRole.SYSTEM, f"{SYSTEM_PROMPT}\n\n{NO_SOURCES_PROMPT}")
    assert repo.messages[-1].citations == []


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


async def test_manual_sources_are_named_as_such_and_saved_with_their_section() -> None:
    class ManualRetriever(FakeRetriever):
        async def retrieve(
            self, query: str, limit: int, document_ids: Sequence[uuid.UUID]
        ) -> list[chat_pb2.Citation]:
            return [
                chat_pb2.Citation(
                    document_title="Chat: Stop an answer",
                    snippet="Select Stop.",
                    score=0.8,
                    manual_page="chat",
                    manual_section="stop-an-answer",
                )
            ]

    chat, repo, _, generator = make(retriever=ManualRetriever())
    events = await collect(chat, repo)

    system = generator.calls[0][1][0]
    assert "[1] User manual, Chat: Stop an answer:\nSelect Stop." in system.content
    saved = events[-1]
    assert isinstance(saved, AnswerSaved)
    (citation,) = saved.message.citations
    assert citation["manual_page"] == "chat"
    assert citation["manual_section"] == "stop-an-answer"
    assert citation["document_id"] == ""


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


async def test_cancelling_the_answer_stops_generation_and_saves_it_as_stopped() -> None:
    generator = HangingGenerator()
    chat, repo, _, _ = make(generator=generator)
    task = asyncio.create_task(collect(chat, repo))
    await generator.waiting.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert generator.closed
    assert [(m.role, m.content, m.status) for m in repo.messages] == [
        (USER, "Capital?", COMPLETE),
        (ASSISTANT, "Par", STOPPED),
    ]
    assert repo.messages[1].citations[0]["document_id"] == "d1"


async def test_closing_the_stream_early_stops_generation_and_saves_it_as_stopped() -> None:
    generator = HangingGenerator(("Par", "is"))
    chat, repo, _, _ = make(generator=generator)
    events = chat.answer(repo.conv.id, "Capital?", "m1", False)

    assert await anext(events) == AnswerDelta("Par")
    await events.aclose()

    assert generator.closed
    assert [(m.content, m.status) for m in repo.messages] == [
        ("Capital?", COMPLETE),
        ("Par", STOPPED),
    ]


async def test_stopped_answers_stay_in_the_prompt_unless_empty() -> None:
    repo = FakeRepo()
    await repo.add_message(repo.conv.id, USER, "first", [])
    await repo.add_message(repo.conv.id, ASSISTANT, "", [], STOPPED)
    await repo.add_message(repo.conv.id, USER, "second", [])
    await repo.add_message(repo.conv.id, ASSISTANT, "half", [], STOPPED)
    chat, repo, _, generator = make(repo)
    await collect(chat, repo, use_kb=False)

    assert [m.content for m in generator.calls[0][1][1:]] == [
        "first",
        "second",
        "half",
        "Capital?",
    ]


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

    def Generate(self, request: Any) -> "FakeCall":
        return FakeCall(self._gen())


class FakeCall:
    """A streaming gRPC call: iterable and cancellable."""

    def __init__(self, responses: AsyncIterator[Any]) -> None:
        self._responses = responses
        self.cancelled = False

    def __aiter__(self) -> AsyncIterator[Any]:
        return self._responses

    def cancel(self) -> bool:
        self.cancelled = True
        return True


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


async def test_closing_the_generator_early_cancels_the_llm_call() -> None:
    class StreamingLlm:
        def __init__(self) -> None:
            self.calls: list[FakeCall] = []

        async def _gen(self) -> AsyncIterator[Any]:
            from kb.llm.v1 import llm_pb2

            for word in ["Par", "is"]:
                yield llm_pb2.GenerateResponse(delta=word)

        def Generate(self, request: Any) -> FakeCall:
            self.calls.append(FakeCall(self._gen()))
            return self.calls[-1]

    llm: Any = StreamingLlm()
    deltas = PeerGenerator(llm).generate("m", [])
    assert await anext(deltas) == "Par"
    assert not llm.calls[0].cancelled
    await deltas.aclose()
    assert llm.calls[0].cancelled


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
