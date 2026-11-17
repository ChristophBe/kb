import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import Any

import grpc
import pytest
from knowcel.chat.v1 import chat_pb2, chat_pb2_grpc
from knowcel.common.v1 import common_pb2
from knowcel.document.v1 import document_pb2
from knowcel.llm.v1 import llm_pb2
from knowcel_chat.chat import Chat
from knowcel_chat.config import Settings
from knowcel_chat.peers import PeerGenerator, PeerRetriever
from knowcel_chat.preview import preview
from knowcel_chat.repository import ConversationMatch, ConversationRow, MessageRow
from knowcel_chat.server import ChatServicer
from knowcel_platform.grpc import (
    USER_HEADER,
    Principal,
    PrincipalResolver,
    Team,
    UserInterceptor,
    field_violations,
)
from knowcel_platform.pagination import Cursor

ALICE, BOB = "alice", "bob"


def servicer(repo: Any, documents: Any, llm: Any) -> ChatServicer:
    chat = Chat(Settings(), repo, PeerRetriever(documents, llm), PeerGenerator(llm))
    return ChatServicer(repo, chat)


def _with_user(details: Any, user: str) -> Any:
    """Call details that send `user` in x-kb-user, as the gateway does for a
    signed-in user."""
    metadata = grpc.aio.Metadata(*(details.metadata or ()), (USER_HEADER, user))
    return details._replace(metadata=metadata)


# grpc.aio files an interceptor under one kind of call only, hence one class each.
class UnaryAsUser(grpc.aio.UnaryUnaryClientInterceptor):
    def __init__(self, user: str) -> None:
        self._user = user

    async def intercept_unary_unary(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        return await continuation(_with_user(client_call_details, self._user), request)


class StreamAsUser(grpc.aio.UnaryStreamClientInterceptor):
    def __init__(self, user: str) -> None:
        self._user = user

    async def intercept_unary_stream(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        return await continuation(_with_user(client_call_details, self._user), request)


# Opens a client of the running server for a user; None calls without a user.
Connect = Callable[..., chat_pb2_grpc.ChatServiceStub]


@contextlib.asynccontextmanager
async def running(
    repo: Any, documents: Any, llm: Any, principals: PrincipalResolver | None = None
) -> AsyncIterator[Connect]:
    """Serves chat with the user interceptor of knowcel_platform.grpc.serve,
    resolving callers' teams with `principals` (none: they are unknown)."""
    server = grpc.aio.server(interceptors=[UserInterceptor(principals)])
    chat_pb2_grpc.add_ChatServiceServicer_to_server(servicer(repo, documents, llm), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with contextlib.AsyncExitStack() as channels:

        def connect(user: str | None = ALICE) -> chat_pb2_grpc.ChatServiceStub:
            interceptors: list[Any] = [UnaryAsUser(user), StreamAsUser(user)] if user else []
            ch = grpc.aio.insecure_channel(f"127.0.0.1:{port}", interceptors=interceptors)
            channels.push_async_callback(ch.close)
            return chat_pb2_grpc.ChatServiceStub(ch)

        yield connect
    await server.stop(None)


class MemoryRepo:
    def __init__(self) -> None:
        self.conversations: dict[uuid.UUID, ConversationRow] = {}
        self.messages: list[MessageRow] = []
        self.searches: list[tuple[str, int]] = []

    def _owned(self, owner: str) -> list[ConversationRow]:
        return [c for c in self.conversations.values() if c.owner_id == owner]

    async def create_conversation(
        self,
        owner: str,
        title: str,
        document_ids: list[uuid.UUID],
        team_ids: list[uuid.UUID] | None = None,
    ):
        now = datetime.now(UTC)
        conv = ConversationRow(uuid.uuid4(), title, now, now, owner, document_ids, team_ids or [])
        self.conversations[conv.id] = conv
        return conv

    async def get_conversation(self, owner: str, id: uuid.UUID):
        conv = self.conversations.get(id)
        return conv if conv is not None and conv.owner_id == owner else None

    async def list_conversations(self, owner: str, limit: int, after: Cursor | None = None):
        convs = sorted(self._owned(owner), key=lambda c: c.cursor.time, reverse=True)
        if after is not None:
            convs = [c for c in convs if (c.cursor.time, c.id) < (after.time, after.id)]
        return convs[:limit]

    async def search_conversations(self, owner: str, query: str, limit: int):
        """Substring matches: titles first, then the first matching message."""
        self.searches.append((query, limit))
        q = query.lower()
        owned = self._owned(owner)
        matches = [ConversationMatch(c) for c in owned if q in c.title.lower()]
        for m in self.messages:
            conv = self.conversations[m.conversation_id]
            if conv not in owned:
                continue
            if q in m.content.lower() and all(x.conversation is not conv for x in matches):
                matches.append(ConversationMatch(conv, preview(m.content)))
        return matches[:limit]

    async def delete_conversation(self, owner: str, id: uuid.UUID):
        if await self.get_conversation(owner, id) is None:
            return False
        del self.conversations[id]
        return True

    async def set_title(self, id: uuid.UUID, title: str):
        self.conversations[id].title = title

    async def set_completed_unseen(self, id: uuid.UUID, unseen: bool):
        self.conversations[id].completed_unseen = unseen

    async def update_conversation(
        self,
        owner: str,
        id: uuid.UUID,
        *,
        title: str | None = None,
        document_ids: list[uuid.UUID] | None = None,
        team_ids: list[uuid.UUID] | None = None,
    ):
        conv = await self.get_conversation(owner, id)
        if conv is not None and title is not None:
            conv.title = title
        if conv is not None and document_ids is not None:
            conv.document_ids = document_ids
        if conv is not None and team_ids is not None:
            conv.team_ids = team_ids
        return conv

    async def list_messages(self, conversation_id: uuid.UUID, limit: int | None = None):
        msgs = [m for m in self.messages if m.conversation_id == conversation_id]
        return msgs[-limit:] if limit else msgs

    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
        status: chat_pb2.MessageStatus = chat_pb2.MESSAGE_STATUS_COMPLETE,
    ):
        msg = MessageRow(
            uuid.uuid4(), conversation_id, role, content, datetime.now(UTC), citations, status
        )
        self.messages.append(msg)
        conv = self.conversations[conversation_id]
        conv.last_message_time, conv.last_message_preview = msg.created_at, preview(content)
        return msg


class FakeLlm:
    def __init__(self) -> None:
        self.prompts: list[list[llm_pb2.Message]] = []
        self.calls: list[FakeCall] = []

    async def Embed(self, request: llm_pb2.EmbedRequest):
        return llm_pb2.EmbedResponse(embeddings=[llm_pb2.Embedding(values=[0.1, 0.2])])

    async def _gen(self):
        for word in ["Paris", " is", " the", " capital", "."]:
            yield llm_pb2.GenerateResponse(delta=word)
        yield llm_pb2.GenerateResponse(done=True)

    def Generate(self, request: llm_pb2.GenerateRequest):
        self.prompts.append(list(request.messages))
        self.calls.append(FakeCall(self._gen()))
        return self.calls[-1]


class FakeCall:
    """A streaming gRPC call: iterable and cancellable."""

    def __init__(self, responses: AsyncIterator[llm_pb2.GenerateResponse]) -> None:
        self._responses = responses
        self.cancelled = False

    def __aiter__(self) -> AsyncIterator[llm_pb2.GenerateResponse]:
        return self._responses

    def cancel(self) -> bool:
        self.cancelled = True
        return True


class FakeDocuments:
    def __init__(self) -> None:
        self.searches: list[document_pb2.SearchChunksRequest] = []

    async def SearchChunks(self, request: document_pb2.SearchChunksRequest):
        self.searches.append(request)
        return document_pb2.SearchChunksResponse(
            results=[
                document_pb2.ScoredChunk(
                    chunk=document_pb2.Chunk(document_id="d1", index=0, text="Paris is in France."),
                    document_title="geo.md",
                    score=0.9,
                )
            ]
        )


Env = tuple[chat_pb2_grpc.ChatServiceStub, MemoryRepo, FakeLlm, FakeDocuments]


@pytest.fixture
async def served() -> AsyncIterator[tuple[Connect, MemoryRepo, FakeLlm, FakeDocuments]]:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm) as connect:
        yield connect, repo, llm, documents


@pytest.fixture
def env(served: tuple[Connect, MemoryRepo, FakeLlm, FakeDocuments]) -> Env:
    """A client for alice."""
    connect, repo, llm, documents = served
    return connect(), repo, llm, documents


async def test_stream_chat_with_knowledge_base(env: Env) -> None:
    stub, _repo, llm, _documents = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation

    events = [
        e
        async for e in stub.StreamChat(
            chat_pb2.StreamChatRequest(
                conversation_id=conv.id, content="Capital of France?", use_knowledge_base=True
            )
        )
    ]
    kinds = [e.WhichOneof("event") for e in events]
    assert kinds[0] == "citations"
    assert kinds[-1] == "message"
    assert set(kinds[1:-1]) == {"delta"}
    assert events[0].citations.items[0].document_title == "geo.md"
    assert events[-1].message.content == "Paris is the capital."
    assert events[-1].message.citations[0].document_id == "d1"
    assert events[-1].message.status == chat_pb2.MESSAGE_STATUS_COMPLETE
    assert "Paris is in France." in llm.prompts[0][0].content  # grounded system prompt

    got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert got.conversation.title == "Capital of France?"
    assert [(m.role, m.status) for m in got.messages] == [
        (chat_pb2.MESSAGE_ROLE_USER, chat_pb2.MESSAGE_STATUS_COMPLETE),
        (chat_pb2.MESSAGE_ROLE_ASSISTANT, chat_pb2.MESSAGE_STATUS_COMPLETE),
    ]


async def test_unknown_conversation_is_not_found(env: Env) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetConversation(chat_pb2.GetConversationRequest(id="nope"))
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


def unavailable(details: str) -> grpc.aio.AioRpcError:
    return grpc.aio.AioRpcError(
        grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), details
    )


class DownLlm(FakeLlm):
    """An llm client whose service is unreachable."""

    async def Embed(self, request: llm_pb2.EmbedRequest):
        raise unavailable("connect failed")


class DyingLlm(FakeLlm):
    """An llm client whose service goes away in the middle of an answer."""

    async def _gen(self):
        yield llm_pb2.GenerateResponse(delta="Paris")
        yield llm_pb2.GenerateResponse(delta=" is")
        raise unavailable("connection reset")


class SlowLlm(FakeLlm):
    """An llm client whose answer stalls after the first words."""

    async def _gen(self):
        yield llm_pb2.GenerateResponse(delta="Paris")
        yield llm_pb2.GenerateResponse(delta=" is")
        await asyncio.Event().wait()
        yield llm_pb2.GenerateResponse(done=True)


class DownDocuments(FakeDocuments):
    async def SearchChunks(self, request: document_pb2.SearchChunksRequest):
        raise unavailable("connect failed")


async def stream_with(
    documents: Any, llm: Any, use_knowledge_base: bool = True
) -> tuple[list[chat_pb2.StreamChatResponse], chat_pb2.GetConversationResponse]:
    """Streams one question and returns the events and the saved conversation."""
    async with running(MemoryRepo(), documents, llm) as connect:
        stub = connect()
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        request = chat_pb2.StreamChatRequest(
            conversation_id=conv.id, content="Hi", use_knowledge_base=use_knowledge_base
        )
        events = [e async for e in stub.StreamChat(request)]
        got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    return events, got


@pytest.mark.parametrize(
    ("documents", "llm", "service"),
    [
        (FakeDocuments(), DownLlm(), "Models"),
        (DownDocuments(), FakeLlm(), "Documents"),
    ],
)
async def test_an_unavailable_peer_ends_the_stream_with_an_error(
    documents: Any, llm: Any, service: str
) -> None:
    events, got = await stream_with(documents, llm)

    assert [e.WhichOneof("event") for e in events] == ["error", "message"]
    assert events[0].error.code == chat_pb2.CHAT_ERROR_CODE_UNAVAILABLE
    assert events[0].error.message == (
        f"The {service} service isn't available. Try again in a moment."
    )
    assert events[1].message.status == chat_pb2.MESSAGE_STATUS_FAILED
    assert [(m.role, m.content, m.status) for m in got.messages] == [
        (chat_pb2.MESSAGE_ROLE_USER, "Hi", chat_pb2.MESSAGE_STATUS_COMPLETE),
        (chat_pb2.MESSAGE_ROLE_ASSISTANT, "", chat_pb2.MESSAGE_STATUS_FAILED),
    ]


async def test_an_llm_failure_mid_answer_keeps_the_partial_answer() -> None:
    events, got = await stream_with(FakeDocuments(), DyingLlm())

    kinds = [e.WhichOneof("event") for e in events]
    assert kinds == ["citations", "delta", "delta", "error", "message"]
    assert events[-1].message.content == "Paris is"
    assert events[-1].message.status == chat_pb2.MESSAGE_STATUS_FAILED
    assert events[-1].message.citations[0].document_id == "d1"
    saved = got.messages[-1]
    assert (saved.content, saved.status) == ("Paris is", chat_pb2.MESSAGE_STATUS_FAILED)


class GatedLlm(FakeLlm):
    """An llm client that writes the first word, then waits for `release`."""

    def __init__(self) -> None:
        super().__init__()
        self.release = asyncio.Event()

    async def _gen(self):
        yield llm_pb2.GenerateResponse(delta="Paris")
        await self.release.wait()
        yield llm_pb2.GenerateResponse(delta=" is")
        yield llm_pb2.GenerateResponse(done=True)


async def _wait_until(condition: Callable[[], Any]) -> None:
    async with asyncio.timeout(2):
        while not condition():  # noqa: ASYNC110
            await asyncio.sleep(0.01)


async def _start_answer(stub: Any, content: str = "Hi") -> tuple[Any, str]:
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    call = stub.StreamChat(
        chat_pb2.StreamChatRequest(
            conversation_id=conv.id, content=content, use_knowledge_base=True
        )
    )
    kinds = [(await call.read()).WhichOneof("event") for _ in range(2)]
    assert kinds == ["citations", "delta"]
    return call, conv.id


async def test_an_answer_keeps_being_written_after_the_client_disconnects() -> None:
    repo, llm = MemoryRepo(), GatedLlm()
    async with running(repo, FakeDocuments(), llm) as connect:
        stub = connect()
        call, conv_id = await _start_answer(stub)
        call.cancel()  # a closed tab or leaving the page
        await _wait_until(lambda: call.done())

        listed = await stub.ListConversations(chat_pb2.ListConversationsRequest())
        assert [(c.generating, c.completed_unseen) for c in listed.conversations] == [(True, False)]

        llm.release.set()
        await _wait_until(lambda: repo.conversations[uuid.UUID(conv_id)].completed_unseen)
        listed = await stub.ListConversations(chat_pb2.ListConversationsRequest())
        assert [(c.generating, c.completed_unseen) for c in listed.conversations] == [(False, True)]

        got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv_id))
        assert [(m.content, m.status) for m in got.messages] == [
            ("Hi", chat_pb2.MESSAGE_STATUS_COMPLETE),
            ("Paris is", chat_pb2.MESSAGE_STATUS_COMPLETE),
        ]
        # Opening the conversation was seeing the answer.
        listed = await stub.ListConversations(chat_pb2.ListConversationsRequest())
        assert not listed.conversations[0].completed_unseen


async def test_an_answer_that_is_followed_to_the_end_is_not_unseen() -> None:
    repo = MemoryRepo()
    async with running(repo, FakeDocuments(), FakeLlm()) as connect:
        stub = connect()
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        request = chat_pb2.StreamChatRequest(conversation_id=conv.id, content="Hi")
        _ = [e async for e in stub.StreamChat(request)]
    assert not repo.conversations[uuid.UUID(conv.id)].completed_unseen


async def test_stop_chat_stops_generation_and_keeps_the_answer_as_stopped() -> None:
    repo, llm = MemoryRepo(), SlowLlm()
    async with running(repo, FakeDocuments(), llm) as connect:
        stub = connect()
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        call = stub.StreamChat(
            chat_pb2.StreamChatRequest(
                conversation_id=conv.id, content="Hi", use_knowledge_base=True
            )
        )
        kinds = [(await call.read()).WhichOneof("event") for _ in range(3)]
        assert kinds == ["citations", "delta", "delta"]

        await stub.StopChat(chat_pb2.StopChatRequest(conversation_id=conv.id))

        got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
        assert not got.conversation.generating
        assert [e async for e in call] == []  # the stream ended

    assert llm.calls[0].cancelled
    assert [(m.role, m.content, m.status) for m in got.messages] == [
        (chat_pb2.MESSAGE_ROLE_USER, "Hi", chat_pb2.MESSAGE_STATUS_COMPLETE),
        (chat_pb2.MESSAGE_ROLE_ASSISTANT, "Paris is", chat_pb2.MESSAGE_STATUS_STOPPED),
    ]
    assert got.messages[1].citations[0].document_id == "d1"
    # A stopped answer is not news.
    assert not repo.conversations[uuid.UUID(conv.id)].completed_unseen


async def test_stop_chat_without_an_answer_does_nothing(env: Env) -> None:
    stub, *_ = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    await stub.StopChat(chat_pb2.StopChatRequest(conversation_id=conv.id))


async def test_stop_chat_of_an_unknown_conversation_is_not_found(env: Env) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.StopChat(chat_pb2.StopChatRequest(conversation_id=str(uuid.uuid4())))
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_a_second_question_while_an_answer_is_written_is_refused() -> None:
    llm = GatedLlm()
    async with running(MemoryRepo(), FakeDocuments(), llm) as connect:
        stub = connect()
        call, conv_id = await _start_answer(stub)
        with pytest.raises(grpc.aio.AioRpcError) as err:
            async for _ in stub.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=conv_id, content="Again")
            ):
                pass
        assert err.value.code() == grpc.StatusCode.FAILED_PRECONDITION
        llm.release.set()
        _ = [e async for e in call]


async def test_deleting_a_conversation_stops_its_answer() -> None:
    repo, llm = MemoryRepo(), SlowLlm()
    async with running(repo, FakeDocuments(), llm) as connect:
        stub = connect()
        call, conv_id = await _start_answer(stub)
        await stub.DeleteConversation(chat_pb2.DeleteConversationRequest(id=conv_id))
        assert not [e for e in [e async for e in call] if e.WhichOneof("event") == "message"]
    assert llm.calls[0].cancelled


async def test_the_runner_stops_all_answers_on_shutdown() -> None:
    repo, llm = MemoryRepo(), SlowLlm()
    svc = servicer(repo, FakeDocuments(), llm)
    conv = await repo.create_conversation(ALICE, "", [])
    svc.runner.start(ALICE, conv.id, "Hi", "", False, None)
    await _wait_until(lambda: llm.calls)
    await svc.shutdown()
    assert [m.status for m in repo.messages[1:]] == [chat_pb2.MESSAGE_STATUS_STOPPED]


async def test_stream_chat_rejects_empty_content(env: Env) -> None:
    stub, *_ = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [
            e
            async for e in stub.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=conv.id, content="  ")
            )
        ]
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(err.value)] == ["content"]


async def test_stream_chat_unknown_conversation_is_not_found(env: Env) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [
            e
            async for e in stub.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=str(uuid.uuid4()), content="Hi")
            )
        ]
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


class BrokenLlm(FakeLlm):
    """An llm client that fails for a reason other than availability."""

    def Generate(self, request: llm_pb2.GenerateRequest):
        raise grpc.aio.AioRpcError(
            grpc.StatusCode.NOT_FOUND, grpc.aio.Metadata(), grpc.aio.Metadata(), "no such model"
        )


async def test_other_peer_errors_are_hidden_from_the_user() -> None:
    events, _ = await stream_with(FakeDocuments(), BrokenLlm(), use_knowledge_base=False)

    assert [e.WhichOneof("event") for e in events] == ["error", "message"]
    assert events[0].error.code == chat_pb2.CHAT_ERROR_CODE_INTERNAL
    assert events[0].error.message == "The Models service couldn't complete the answer."
    assert "no such model" not in events[0].error.message
    assert events[1].message.status == chat_pb2.MESSAGE_STATUS_FAILED


async def test_rename_persists_and_shows_in_the_list(env: Env) -> None:
    stub, *_ = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation

    resp = await stub.UpdateConversation(
        chat_pb2.UpdateConversationRequest(id=conv.id, title="  Q3 revenue  ")
    )

    assert resp.conversation.title == "Q3 revenue"
    listed = await stub.ListConversations(chat_pb2.ListConversationsRequest())
    assert [c.title for c in listed.conversations] == ["Q3 revenue"]


async def test_list_shows_the_latest_message_and_sorts_by_it(env: Env) -> None:
    stub, *_ = env
    older = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    newer = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    empty = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    async for _ in stub.StreamChat(
        chat_pb2.StreamChatRequest(conversation_id=older.id, content="Capital of France?")
    ):
        pass

    listed = (await stub.ListConversations(chat_pb2.ListConversationsRequest())).conversations

    # The answered conversation moves up; the two without messages keep creation order.
    assert [c.id for c in listed] == [older.id, empty.id, newer.id]
    assert listed[0].last_message_preview == "Paris is the capital."
    assert listed[0].HasField("last_message_time")
    assert listed[1].last_message_preview == ""
    assert not listed[1].HasField("last_message_time")


async def test_update_without_a_title_keeps_it(env: Env) -> None:
    stub, *_ = env
    request = chat_pb2.CreateConversationRequest(title="Keep me")
    conv = (await stub.CreateConversation(request)).conversation
    resp = await stub.UpdateConversation(chat_pb2.UpdateConversationRequest(id=conv.id))
    assert resp.conversation.title == "Keep me"


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
async def test_rename_rejects_invalid_titles(env: Env, title: str) -> None:
    stub, *_ = env
    request = chat_pb2.CreateConversationRequest(title="Old")
    conv = (await stub.CreateConversation(request)).conversation
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.UpdateConversation(chat_pb2.UpdateConversationRequest(id=conv.id, title=title))
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(err.value)] == ["title"]
    got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert got.conversation.title == "Old"


@pytest.mark.parametrize("conversation_id", [str(uuid.uuid4()), "not-a-uuid"])
async def test_rename_unknown_conversation_is_not_found(env: Env, conversation_id: str) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.UpdateConversation(
            chat_pb2.UpdateConversationRequest(id=conversation_id, title="New")
        )
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


D1, D2 = str(uuid.uuid4()), str(uuid.uuid4())


async def ask(stub: chat_pb2_grpc.ChatServiceStub, conversation_id: str) -> None:
    request = chat_pb2.StreamChatRequest(
        conversation_id=conversation_id, content="Capital?", use_knowledge_base=True
    )
    _ = [e async for e in stub.StreamChat(request)]


async def test_a_scoped_conversation_searches_only_its_documents(env: Env) -> None:
    stub, _, _, documents = env
    request = chat_pb2.CreateConversationRequest(document_ids=[D1, D2, D1])
    conv = (await stub.CreateConversation(request)).conversation
    assert list(conv.document_ids) == [D1, D2]  # duplicates dropped, order kept

    await ask(stub, conv.id)

    assert list(documents.searches[0].document_ids) == [D1, D2]
    got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert list(got.conversation.document_ids) == [D1, D2]


async def test_an_empty_scope_searches_all_documents(env: Env) -> None:
    stub, _, _, documents = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    await ask(stub, conv.id)
    assert list(documents.searches[0].document_ids) == []


async def test_update_replaces_the_scope_and_keeps_the_title(env: Env) -> None:
    stub, _, _, documents = env
    request = chat_pb2.CreateConversationRequest(title="Q3", document_ids=[D1])
    conv = (await stub.CreateConversation(request)).conversation

    resp = await stub.UpdateConversation(
        chat_pb2.UpdateConversationRequest(id=conv.id, document_ids=chat_pb2.DocumentIds(ids=[D2]))
    )
    assert resp.conversation.title == "Q3"
    assert list(resp.conversation.document_ids) == [D2]

    await ask(stub, conv.id)
    assert list(documents.searches[0].document_ids) == [D2]


async def test_rename_keeps_the_scope(env: Env) -> None:
    stub, *_ = env
    request = chat_pb2.CreateConversationRequest(document_ids=[D1])
    conv = (await stub.CreateConversation(request)).conversation
    resp = await stub.UpdateConversation(
        chat_pb2.UpdateConversationRequest(id=conv.id, title="New")
    )
    assert list(resp.conversation.document_ids) == [D1]


async def test_an_empty_update_clears_the_scope(env: Env) -> None:
    stub, *_ = env
    request = chat_pb2.CreateConversationRequest(document_ids=[D1])
    conv = (await stub.CreateConversation(request)).conversation
    resp = await stub.UpdateConversation(
        chat_pb2.UpdateConversationRequest(id=conv.id, document_ids=chat_pb2.DocumentIds())
    )
    assert list(resp.conversation.document_ids) == []


@pytest.mark.parametrize(
    ("ids", "field"),
    [
        (["not-a-uuid"], "document_ids[0]"),
        ([str(uuid.uuid4()) for _ in range(101)], "document_ids"),
    ],
)
async def test_invalid_scopes_are_rejected(env: Env, ids: list[str], field: str) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as created:
        await stub.CreateConversation(chat_pb2.CreateConversationRequest(document_ids=ids))
    assert created.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(created.value)] == [field]

    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    with pytest.raises(grpc.aio.AioRpcError) as updated:
        await stub.UpdateConversation(
            chat_pb2.UpdateConversationRequest(
                id=conv.id, document_ids=chat_pb2.DocumentIds(ids=ids)
            )
        )
    assert updated.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(updated.value)] == [
        field.replace("document_ids", "document_ids.ids", 1)
    ]


async def test_search_returns_conversations_with_their_snippet(env: Env) -> None:
    stub, repo, *_ = env
    talked = await repo.create_conversation(ALICE, "Holidays", [])
    await repo.add_message(talked.id, chat_pb2.MESSAGE_ROLE_USER, "Museums in **Lisbon**?", [])
    titled = await repo.create_conversation(ALICE, "Lisbon trip", [])
    await repo.create_conversation(ALICE, "Unrelated", [])

    resp = await stub.SearchConversations(chat_pb2.SearchConversationsRequest(query=" lisbon "))

    assert [(r.conversation.id, r.snippet) for r in resp.results] == [
        (str(titled.id), ""),
        (str(talked.id), "Museums in Lisbon?"),
    ]
    assert resp.results[1].conversation.title == "Holidays"
    assert resp.results[1].conversation.last_message_preview == "Museums in Lisbon?"
    # The query is trimmed; the limit defaults to 20.
    assert repo.searches == [("lisbon", 20)]


@pytest.mark.parametrize(("limit", "used"), [(5, 5), (500, 50)])
async def test_search_caps_the_limit(env: Env, limit: int, used: int) -> None:
    stub, repo, *_ = env
    await stub.SearchConversations(chat_pb2.SearchConversationsRequest(query="x", limit=limit))
    assert repo.searches == [("x", used)]


@pytest.mark.parametrize(
    ("query", "limit", "field"), [("", 0, "query"), ("   ", 0, "query"), ("x", -1, "limit")]
)
async def test_search_rejects_invalid_requests(
    env: Env, query: str, limit: int, field: str
) -> None:
    stub, repo, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.SearchConversations(
            chat_pb2.SearchConversationsRequest(query=query, limit=limit)
        )
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(err.value)] == [field]
    assert repo.searches == []


Served = tuple[Connect, MemoryRepo, FakeLlm, FakeDocuments]


async def test_a_conversation_belongs_to_its_creator(served: Served) -> None:
    connect, *_ = served
    conv = (
        await connect(BOB).CreateConversation(chat_pb2.CreateConversationRequest())
    ).conversation

    assert conv.owner_id == BOB
    got = await connect(BOB).GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert got.conversation.owner_id == BOB


async def test_users_see_only_their_own_conversations(served: Served) -> None:
    connect, repo, *_ = served
    alice, bob = connect(ALICE), connect(BOB)
    mine = (
        await alice.CreateConversation(chat_pb2.CreateConversationRequest(title="Lisbon"))
    ).conversation
    await repo.add_message(uuid.UUID(mine.id), chat_pb2.MESSAGE_ROLE_USER, "Lisbon?", [])
    theirs = (
        await bob.CreateConversation(chat_pb2.CreateConversationRequest(title="Lisbon too"))
    ).conversation

    listed = await alice.ListConversations(chat_pb2.ListConversationsRequest())
    found = await alice.SearchConversations(chat_pb2.SearchConversationsRequest(query="lisbon"))

    assert [c.id for c in listed.conversations] == [mine.id]
    assert [r.conversation.id for r in found.results] == [mine.id]
    listed = await bob.ListConversations(chat_pb2.ListConversationsRequest())
    found = await bob.SearchConversations(chat_pb2.SearchConversationsRequest(query="lisbon"))
    assert [c.id for c in listed.conversations] == [theirs.id]
    assert [r.conversation.id for r in found.results] == [theirs.id]


async def test_another_users_conversation_is_not_found(served: Served) -> None:
    connect, repo, *_ = served
    conv = (
        await connect(ALICE).CreateConversation(chat_pb2.CreateConversationRequest(title="Mine"))
    ).conversation
    bob = connect(BOB)

    calls = [
        bob.GetConversation(chat_pb2.GetConversationRequest(id=conv.id)),
        bob.UpdateConversation(chat_pb2.UpdateConversationRequest(id=conv.id, title="Taken")),
        bob.DeleteConversation(chat_pb2.DeleteConversationRequest(id=conv.id)),
    ]
    for call in calls:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await call
        assert err.value.code() == grpc.StatusCode.NOT_FOUND
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [
            e
            async for e in bob.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=conv.id, content="Hi")
            )
        ]
    assert err.value.code() == grpc.StatusCode.NOT_FOUND

    # Untouched: still there, still named, no message from bob.
    got = await connect(ALICE).GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert got.conversation.title == "Mine"
    assert repo.messages == []


async def test_calls_without_a_user_are_unauthenticated(served: Served) -> None:
    connect, repo, *_ = served
    stub = connect(None)
    conv = await repo.create_conversation(ALICE, "Mine", [])

    calls = [
        stub.CreateConversation(chat_pb2.CreateConversationRequest()),
        stub.GetConversation(chat_pb2.GetConversationRequest(id=str(conv.id))),
        stub.ListConversations(chat_pb2.ListConversationsRequest()),
        stub.UpdateConversation(chat_pb2.UpdateConversationRequest(id=str(conv.id), title="x")),
        stub.DeleteConversation(chat_pb2.DeleteConversationRequest(id=str(conv.id))),
        stub.SearchConversations(chat_pb2.SearchConversationsRequest(query="mine")),
    ]
    for call in calls:
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await call
        assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [
            e
            async for e in stub.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=str(conv.id), content="Hi")
            )
        ]
    assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED
    assert list(repo.conversations) == [conv.id]


async def test_list_conversations_pages_with_opaque_tokens(env: Env) -> None:
    stub, *_ = env
    for title in ["a", "b", "c"]:
        await stub.CreateConversation(chat_pb2.CreateConversationRequest(title=title))

    first = await stub.ListConversations(
        chat_pb2.ListConversationsRequest(page=common_pb2.PageRequest(page_size=2))
    )
    assert first.page.next_page_token
    second = await stub.ListConversations(
        chat_pb2.ListConversationsRequest(
            page=common_pb2.PageRequest(page_size=2, page_token=first.page.next_page_token)
        )
    )

    assert [c.title for c in first.conversations] == ["c", "b"]
    assert [c.title for c in second.conversations] == ["a"]
    assert second.page.next_page_token == ""


@pytest.mark.parametrize("token", ["2", "!!!", "bm90IGpzb24"])
async def test_list_conversations_rejects_invalid_page_tokens(env: Env, token: str) -> None:
    stub, *_ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.ListConversations(
            chat_pb2.ListConversationsRequest(page=common_pb2.PageRequest(page_token=token))
        )

    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert [v.field for v in field_violations(err.value)] == ["page.page_token"]


T1, T2, T3 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


async def member_of(*teams: str) -> PrincipalResolver:
    async def resolve(user: str) -> Principal:
        return Principal(user, teams=tuple(Team(t) for t in teams))

    return PrincipalResolver(resolve)


async def test_a_team_scoped_conversation_searches_only_its_teams() -> None:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm, await member_of(T1, T2)) as connect:
        stub = connect()
        request = chat_pb2.CreateConversationRequest(team_ids=[T1, T1, T2])
        conv = (await stub.CreateConversation(request)).conversation
        assert list(conv.team_ids) == [T1, T2]  # duplicates dropped, order kept

        await ask(stub, conv.id)
        assert list(documents.searches[0].team_ids) == [T1, T2]

        # The scope can change, and an empty one means all documents again.
        resp = await stub.UpdateConversation(
            chat_pb2.UpdateConversationRequest(id=conv.id, team_ids=chat_pb2.TeamIds(ids=[T2]))
        )
        assert list(resp.conversation.team_ids) == [T2]
        resp = await stub.UpdateConversation(
            chat_pb2.UpdateConversationRequest(id=conv.id, title="Renamed")
        )
        assert list(resp.conversation.team_ids) == [T2]  # kept
        await ask(stub, conv.id)
        assert list(documents.searches[1].team_ids) == [T2]
        resp = await stub.UpdateConversation(
            chat_pb2.UpdateConversationRequest(id=conv.id, team_ids=chat_pb2.TeamIds())
        )
        assert list(resp.conversation.team_ids) == []
        await ask(stub, conv.id)
        assert list(documents.searches[2].team_ids) == []


async def test_a_conversation_without_teams_searches_all_documents() -> None:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm, await member_of(T1)) as connect:
        stub = connect()
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        await ask(stub, conv.id)
    assert list(documents.searches[0].team_ids) == []


async def test_teams_the_user_left_are_not_searched() -> None:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm, await member_of(T1, T2)) as connect:
        stub = connect()
        conv = (
            await stub.CreateConversation(chat_pb2.CreateConversationRequest(team_ids=[T1, T2]))
        ).conversation
    # The user is in T2 only now; T1 was deleted or left.
    async with running(repo, documents, llm, await member_of(T2)) as connect:
        await ask(connect(), conv.id)
    assert list(documents.searches[0].team_ids) == [T2]
    # With no team of the conversation left, all documents are searched.
    async with running(repo, documents, llm, await member_of(T3)) as connect:
        await ask(connect(), conv.id)
    assert list(documents.searches[1].team_ids) == []


async def test_a_team_the_user_is_not_in_is_permission_denied() -> None:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm, await member_of(T1)) as connect:
        stub = connect()
        with pytest.raises(grpc.aio.AioRpcError) as created:
            await stub.CreateConversation(chat_pb2.CreateConversationRequest(team_ids=[T1, T2]))
        assert created.value.code() == grpc.StatusCode.PERMISSION_DENIED
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        with pytest.raises(grpc.aio.AioRpcError) as updated:
            await stub.UpdateConversation(
                chat_pb2.UpdateConversationRequest(id=conv.id, team_ids=chat_pb2.TeamIds(ids=[T2]))
            )
        assert updated.value.code() == grpc.StatusCode.PERMISSION_DENIED
        with pytest.raises(grpc.aio.AioRpcError) as invalid:
            await stub.CreateConversation(chat_pb2.CreateConversationRequest(team_ids=["nope"]))
        assert invalid.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert len(repo.conversations) == 1


async def test_teams_are_unavailable_while_iam_is_down() -> None:
    async def down(user: str) -> Principal:
        raise ConnectionError("iam is down")

    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    async with running(repo, documents, llm, PrincipalResolver(down)) as connect:
        stub = connect()
        with pytest.raises(grpc.aio.AioRpcError) as created:
            await stub.CreateConversation(chat_pb2.CreateConversationRequest(team_ids=[T1]))
        assert created.value.code() == grpc.StatusCode.UNAVAILABLE
        # All documents still work, and so does asking in a conversation that has teams.
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        await ask(stub, conv.id)
        repo.conversations[uuid.UUID(conv.id)].team_ids = [uuid.UUID(T1)]
        await ask(stub, conv.id)
    assert list(documents.searches[0].team_ids) == []
    assert list(documents.searches[1].team_ids) == [T1]
