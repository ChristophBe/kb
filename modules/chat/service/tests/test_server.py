import uuid
from datetime import UTC, datetime

import grpc
import pytest
from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.document.v1 import document_pb2
from kb.llm.v1 import llm_pb2
from kb_chat.config import Settings
from kb_chat.db import ConversationRow, MessageRow
from kb_chat.server import ChatServicer


class MemoryRepo:
    def __init__(self) -> None:
        self.conversations: dict[uuid.UUID, ConversationRow] = {}
        self.messages: list[MessageRow] = []

    async def create_conversation(self, title):
        now = datetime.now(UTC)
        conv = ConversationRow(id=uuid.uuid4(), title=title, created_at=now, updated_at=now)
        self.conversations[conv.id] = conv
        return conv

    async def get_conversation(self, id):
        return self.conversations.get(id)

    async def list_conversations(self, limit, offset):
        return list(self.conversations.values())[offset : offset + limit]

    async def delete_conversation(self, id):
        return self.conversations.pop(id, None) is not None

    async def set_title(self, id, title):
        self.conversations[id].title = title

    async def list_messages(self, conversation_id, limit=None):
        msgs = [m for m in self.messages if m.conversation_id == conversation_id]
        return msgs[-limit:] if limit else msgs

    async def add_message(self, conversation_id, role, content, citations):
        msg = MessageRow(uuid.uuid4(), conversation_id, role, content, datetime.now(UTC), citations)
        self.messages.append(msg)
        return msg


class FakeLlm:
    def __init__(self) -> None:
        self.prompts: list[list[llm_pb2.Message]] = []

    async def Embed(self, request):
        return llm_pb2.EmbedResponse(embeddings=[llm_pb2.Embedding(values=[0.1, 0.2])])

    async def _gen(self):
        for word in ["Paris", " is", " the", " capital", "."]:
            yield llm_pb2.GenerateResponse(delta=word)
        yield llm_pb2.GenerateResponse(done=True)

    def Generate(self, request):
        self.prompts.append(list(request.messages))
        return self._gen()


class FakeDocuments:
    async def SearchChunks(self, request):
        return document_pb2.SearchChunksResponse(
            results=[
                document_pb2.ScoredChunk(
                    chunk=document_pb2.Chunk(document_id="d1", index=0, text="Paris is in France."),
                    document_title="geo.md",
                    score=0.9,
                )
            ]
        )


@pytest.fixture
async def env():
    repo, llm = MemoryRepo(), FakeLlm()
    server = grpc.aio.server()
    chat_pb2_grpc.add_ChatServiceServicer_to_server(
        ChatServicer(Settings(), repo, FakeDocuments(), llm),
        server,  # type: ignore[arg-type]
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        yield chat_pb2_grpc.ChatServiceStub(ch), repo, llm
    await server.stop(None)


async def test_stream_chat_with_knowledge_base(env) -> None:
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


async def test_unknown_conversation_is_not_found(env) -> None:
    stub, _, _ = env
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetConversation(chat_pb2.GetConversationRequest(id="nope"))
    assert err.value.code() == grpc.StatusCode.NOT_FOUND
