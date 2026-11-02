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
from kb_chat.repository import ConversationRow, MessageRow
from kb_chat.server import ChatServicer


def servicer(repo: Any, documents: Any, llm: Any) -> ChatServicer:
    chat = Chat(Settings(), repo, PeerRetriever(documents, llm), PeerGenerator(llm))
    return ChatServicer(repo, chat)


class MemoryRepo:
    def __init__(self) -> None:
        self.conversations: dict[uuid.UUID, ConversationRow] = {}
        self.messages: list[MessageRow] = []

    async def create_conversation(self, title: str):
        now = datetime.now(UTC)
        conv = ConversationRow(id=uuid.uuid4(), title=title, created_at=now, updated_at=now)
        self.conversations[conv.id] = conv
        return conv

    async def get_conversation(self, id: uuid.UUID):
        return self.conversations.get(id)

    async def list_conversations(self, limit: int, offset: int):
        return list(self.conversations.values())[offset : offset + limit]

    async def delete_conversation(self, id: uuid.UUID):
        return self.conversations.pop(id, None) is not None

    async def set_title(self, id: uuid.UUID, title: str):
        self.conversations[id].title = title

    async def list_messages(self, conversation_id: uuid.UUID, limit: int | None = None):
        msgs = [m for m in self.messages if m.conversation_id == conversation_id]
        return msgs[-limit:] if limit else msgs

    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: chat_pb2.MessageRole,
        content: str,
        citations: list[dict[str, Any]],
    ):
        msg = MessageRow(uuid.uuid4(), conversation_id, role, content, datetime.now(UTC), citations)
        self.messages.append(msg)
        return msg


class FakeLlm:
    def __init__(self) -> None:
        self.prompts: list[list[llm_pb2.Message]] = []

    async def Embed(self, request: llm_pb2.EmbedRequest):
        return llm_pb2.EmbedResponse(embeddings=[llm_pb2.Embedding(values=[0.1, 0.2])])

    async def _gen(self):
        for word in ["Paris", " is", " the", " capital", "."]:
            yield llm_pb2.GenerateResponse(delta=word)
        yield llm_pb2.GenerateResponse(done=True)

    def Generate(self, request: llm_pb2.GenerateRequest):
        self.prompts.append(list(request.messages))
        return self._gen()


class FakeDocuments:
    async def SearchChunks(self, request: document_pb2.SearchChunksRequest):
        return document_pb2.SearchChunksResponse(
            results=[
                document_pb2.ScoredChunk(
                    chunk=document_pb2.Chunk(document_id="d1", index=0, text="Paris is in France."),
                    document_title="geo.md",
                    score=0.9,
                )
            ]
        )


Env = tuple[chat_pb2_grpc.ChatServiceStub, MemoryRepo, FakeLlm]


@pytest.fixture
async def env() -> AsyncIterator[Env]:
    repo, llm = MemoryRepo(), FakeLlm()
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(
        servicer(repo, FakeDocuments(), llm),
        server,
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        yield chat_pb2_grpc.ChatServiceStub(ch), repo, llm
    await server.stop(None)


async def test_stream_chat_with_knowledge_base(env: Env) -> None:
    stub, _repo, llm = env
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
    assert "Paris is in France." in llm.prompts[0][0].content  # grounded system prompt

    got = await stub.GetConversation(chat_pb2.GetConversationRequest(id=conv.id))
    assert got.conversation.title == "Capital of France?"
    assert [m.role for m in got.messages] == [
        chat_pb2.MESSAGE_ROLE_USER,
        chat_pb2.MESSAGE_ROLE_ASSISTANT,
    ]


async def test_unknown_conversation_is_not_found(env: Env) -> None:
    stub, _, _ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetConversation(chat_pb2.GetConversationRequest(id="nope"))
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


class DownLlm(FakeLlm):
    """An llm client whose service is unreachable."""

    async def Embed(self, request: llm_pb2.EmbedRequest):
        raise grpc.aio.AioRpcError(
            grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "connect failed"
        )


async def test_stream_chat_without_llm_is_unavailable() -> None:
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(
        servicer(MemoryRepo(), FakeDocuments(), DownLlm()),
        server,
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        stub = chat_pb2_grpc.ChatServiceStub(ch)
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        request = chat_pb2.StreamChatRequest(
            conversation_id=conv.id, content="Hi", use_knowledge_base=True
        )
        with pytest.raises(grpc.aio.AioRpcError) as err:
            _ = [e async for e in stub.StreamChat(request)]
    await server.stop(None)
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


async def test_stream_chat_rejects_empty_content(env: Env) -> None:
    stub, _, _ = env
    conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
    with pytest.raises(grpc.aio.AioRpcError) as err:
        _ = [
            e
            async for e in stub.StreamChat(
                chat_pb2.StreamChatRequest(conversation_id=conv.id, content="  ")
            )
        ]
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_stream_chat_unknown_conversation_is_not_found(env: Env) -> None:
    stub, _, _ = env
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


async def test_stream_chat_hides_other_peer_errors() -> None:
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(
        servicer(MemoryRepo(), FakeDocuments(), BrokenLlm()), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        stub = chat_pb2_grpc.ChatServiceStub(ch)
        conv = (await stub.CreateConversation(chat_pb2.CreateConversationRequest())).conversation
        request = chat_pb2.StreamChatRequest(conversation_id=conv.id, content="Hi")
        with pytest.raises(grpc.aio.AioRpcError) as err:
            _ = [e async for e in stub.StreamChat(request)]
    await server.stop(None)
    assert err.value.code() == grpc.StatusCode.INTERNAL
    assert "no such model" not in (err.value.details() or "")
