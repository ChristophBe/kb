import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import grpc
import pytest
from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.document.v1 import document_pb2
from kb.llm.v1 import llm_pb2
from kb_chat.chat import Chat
from kb_chat.config import Settings
from kb_chat.peers import PeerGenerator, PeerRetriever
from kb_chat.preview import preview
from kb_chat.repository import ConversationMatch, ConversationRow, MessageRow
from kb_chat.server import ChatServicer
from kb_platform.grpc import field_violations


def servicer(repo: Any, documents: Any, llm: Any) -> ChatServicer:
    chat = Chat(Settings(), repo, PeerRetriever(documents, llm), PeerGenerator(llm))
    return ChatServicer(repo, chat)


class MemoryRepo:
    def __init__(self) -> None:
        self.conversations: dict[uuid.UUID, ConversationRow] = {}
        self.messages: list[MessageRow] = []
        self.searches: list[tuple[str, int]] = []

    async def create_conversation(self, title: str, document_ids: list[uuid.UUID]):
        now = datetime.now(UTC)
        conv = ConversationRow(uuid.uuid4(), title, now, now, document_ids)
        self.conversations[conv.id] = conv
        return conv

    async def get_conversation(self, id: uuid.UUID):
        return self.conversations.get(id)

    async def list_conversations(self, limit: int, offset: int):
        convs = sorted(
            self.conversations.values(),
            key=lambda c: c.last_message_time or c.created_at,
            reverse=True,
        )
        return convs[offset : offset + limit]

    async def search_conversations(self, query: str, limit: int):
        """Substring matches: titles first, then the first matching message."""
        self.searches.append((query, limit))
        q = query.lower()
        titled = [c for c in self.conversations.values() if q in c.title.lower()]
        matches = [ConversationMatch(c) for c in titled]
        for m in self.messages:
            conv = self.conversations[m.conversation_id]
            if q in m.content.lower() and all(x.conversation is not conv for x in matches):
                matches.append(ConversationMatch(conv, preview(m.content)))
        return matches[:limit]

    async def delete_conversation(self, id: uuid.UUID):
        return self.conversations.pop(id, None) is not None

    async def set_title(self, id: uuid.UUID, title: str):
        self.conversations[id].title = title

    async def update_conversation(
        self,
        id: uuid.UUID,
        *,
        title: str | None = None,
        document_ids: list[uuid.UUID] | None = None,
    ):
        conv = self.conversations.get(id)
        if conv is not None and title is not None:
            conv.title = title
        if conv is not None and document_ids is not None:
            conv.document_ids = document_ids
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
async def env() -> AsyncIterator[Env]:
    repo, llm, documents = MemoryRepo(), FakeLlm(), FakeDocuments()
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(
        servicer(repo, documents, llm),
        server,
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        yield chat_pb2_grpc.ChatServiceStub(ch), repo, llm, documents
    await server.stop(None)


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
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(servicer(MemoryRepo(), documents, llm), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        stub = chat_pb2_grpc.ChatServiceStub(ch)
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        request = chat_pb2.StreamChatRequest(
            conversation_id=conv.id, content="Hi", use_knowledge_base=use_knowledge_base
        )
        events = [e async for e in stub.StreamChat(request)]
        got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    await server.stop(None)
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


async def test_a_cancelled_stream_stops_generation_and_keeps_the_answer_as_stopped() -> None:
    class WatchedRepo(MemoryRepo):
        def __init__(self) -> None:
            super().__init__()
            self.answered = asyncio.Event()

        async def add_message(self, *args: Any, **kwargs: Any):
            msg = await super().add_message(*args, **kwargs)
            if msg.role == chat_pb2.MESSAGE_ROLE_ASSISTANT:
                self.answered.set()
            return msg

    repo, llm = WatchedRepo(), SlowLlm()
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(servicer(repo, FakeDocuments(), llm), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        stub = chat_pb2_grpc.ChatServiceStub(ch)
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        call = stub.StreamChat(
            chat_pb2.StreamChatRequest(
                conversation_id=conv.id, content="Hi", use_knowledge_base=True
            )
        )
        kinds = [(await call.read()).WhichOneof("event") for _ in range(3)]
        assert kinds == ["citations", "delta", "delta"]
        call.cancel()  # what the browser's abort (Stop, a closed tab) becomes

        async with asyncio.timeout(1):
            await repo.answered.wait()
        got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    await server.stop(None)

    assert llm.calls[0].cancelled
    assert [(m.role, m.content, m.status) for m in got.messages] == [
        (chat_pb2.MESSAGE_ROLE_USER, "Hi", chat_pb2.MESSAGE_STATUS_COMPLETE),
        (chat_pb2.MESSAGE_ROLE_ASSISTANT, "Paris is", chat_pb2.MESSAGE_STATUS_STOPPED),
    ]
    assert got.messages[1].citations[0].document_id == "d1"


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
    talked = await repo.create_conversation("Holidays", [])
    await repo.add_message(talked.id, chat_pb2.MESSAGE_ROLE_USER, "Museums in **Lisbon**?", [])
    titled = await repo.create_conversation("Lisbon trip", [])
    await repo.create_conversation("Unrelated", [])

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
