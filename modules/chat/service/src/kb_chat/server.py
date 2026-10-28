import uuid
from collections.abc import AsyncIterator

import grpc
from google.protobuf.timestamp_pb2 import Timestamp
from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.common.v1 import common_pb2
from kb.document.v1 import document_pb2, document_pb2_grpc
from kb.llm.v1 import llm_pb2, llm_pb2_grpc

from .config import Settings
from .db import ConversationRow, MessageRow, Repository

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
TITLE_LENGTH = 60

SYSTEM_PROMPT = "You are a helpful assistant for a personal knowledge base. Answer concisely."
RAG_PROMPT = (
    "Answer using the numbered sources below when they are relevant and cite them like [1]. "
    "If the sources do not contain the answer, say so.\n\nSources:\n{sources}"
)

_LLM_ROLES = {
    chat_pb2.MESSAGE_ROLE_USER: llm_pb2.ROLE_USER,
    chat_pb2.MESSAGE_ROLE_ASSISTANT: llm_pb2.ROLE_ASSISTANT,
}


class ChatServicer(chat_pb2_grpc.ChatServiceServicer):
    def __init__(
        self,
        settings: Settings,
        repo: Repository,
        documents: document_pb2_grpc.DocumentServiceStub,
        llm: llm_pb2_grpc.LlmServiceStub,
    ) -> None:
        self._settings = settings
        self._repo = repo
        self._documents = documents
        self._llm = llm

    async def CreateConversation(self, request, context) -> chat_pb2.CreateConversationResponse:
        conv = await self._repo.create_conversation(request.title)
        return chat_pb2.CreateConversationResponse(conversation=_conversation(conv))

    async def GetConversation(self, request, context) -> chat_pb2.GetConversationResponse:
        conv = await self._get(request.id, context)
        msgs = await self._repo.list_messages(conv.id)
        return chat_pb2.GetConversationResponse(
            conversation=_conversation(conv), messages=[_message(m) for m in msgs]
        )

    async def ListConversations(self, request, context) -> chat_pb2.ListConversationsResponse:
        limit = min(request.page.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
        try:
            offset = int(request.page.page_token or 0)
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "invalid page token")
        rows = await self._repo.list_conversations(limit + 1, offset)
        token = str(offset + limit) if len(rows) > limit else ""
        return chat_pb2.ListConversationsResponse(
            conversations=[_conversation(c) for c in rows[:limit]],
            page=common_pb2.PageResponse(next_page_token=token),
        )

    async def DeleteConversation(self, request, context) -> chat_pb2.DeleteConversationResponse:
        if not await self._repo.delete_conversation(_parse_id(request.id)):
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        return chat_pb2.DeleteConversationResponse()

    async def StreamChat(
        self, request: chat_pb2.StreamChatRequest, context: grpc.aio.ServicerContext
    ) -> AsyncIterator[chat_pb2.StreamChatResponse]:
        content = request.content.strip()
        if not content:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "content must not be empty")
        conv = await self._get(request.conversation_id, context)
        history = await self._repo.list_messages(conv.id, self._settings.history_limit)
        await self._repo.add_message(conv.id, chat_pb2.MESSAGE_ROLE_USER, content, [])
        if not conv.title:
            await self._repo.set_title(conv.id, content[:TITLE_LENGTH])

        citations: list[chat_pb2.Citation] = []
        if request.use_knowledge_base:
            citations = await self._retrieve(content)
            yield chat_pb2.StreamChatResponse(citations=chat_pb2.Citations(items=citations))

        prompt = [llm_pb2.Message(role=llm_pb2.ROLE_SYSTEM, content=self._system_prompt(citations))]
        prompt += [llm_pb2.Message(role=_LLM_ROLES[m.role], content=m.content) for m in history]
        prompt.append(llm_pb2.Message(role=llm_pb2.ROLE_USER, content=content))

        answer: list[str] = []
        async for chunk in self._llm.Generate(
            llm_pb2.GenerateRequest(model=request.model, messages=prompt)
        ):
            if chunk.delta:
                answer.append(chunk.delta)
                yield chat_pb2.StreamChatResponse(delta=chunk.delta)

        saved = await self._repo.add_message(
            conv.id,
            chat_pb2.MESSAGE_ROLE_ASSISTANT,
            "".join(answer),
            [_citation_to_dict(c) for c in citations],
        )
        yield chat_pb2.StreamChatResponse(message=_message(saved))

    async def _retrieve(self, query: str) -> list[chat_pb2.Citation]:
        embedded = await self._llm.Embed(llm_pb2.EmbedRequest(inputs=[query]))
        result = await self._documents.SearchChunks(
            document_pb2.SearchChunksRequest(
                embedding=embedded.embeddings[0].values, limit=self._settings.rag_top_k
            )
        )
        return [
            chat_pb2.Citation(
                document_id=r.chunk.document_id,
                document_title=r.document_title,
                chunk_index=r.chunk.index,
                snippet=r.chunk.text,
                score=r.score,
            )
            for r in result.results
        ]

    @staticmethod
    def _system_prompt(citations: list[chat_pb2.Citation]) -> str:
        if not citations:
            return SYSTEM_PROMPT
        sources = "\n\n".join(
            f"[{i}] {c.document_title}:\n{c.snippet}" for i, c in enumerate(citations, start=1)
        )
        return f"{SYSTEM_PROMPT}\n\n{RAG_PROMPT.format(sources=sources)}"

    async def _get(self, raw_id: str, context) -> ConversationRow:
        conv = await self._repo.get_conversation(_parse_id(raw_id))
        if conv is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "conversation not found")
        assert conv is not None
        return conv


def _parse_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        # Unknown ids and malformed ids are both "not found" for callers.
        return uuid.UUID(int=0)


def _ts(value) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(value)
    return ts


def _conversation(c: ConversationRow) -> chat_pb2.Conversation:
    return chat_pb2.Conversation(
        id=str(c.id), title=c.title, create_time=_ts(c.created_at), update_time=_ts(c.updated_at)
    )


def _message(m: MessageRow) -> chat_pb2.ChatMessage:
    return chat_pb2.ChatMessage(
        id=str(m.id),
        role=m.role,  # type: ignore[arg-type]
        content=m.content,
        citations=[chat_pb2.Citation(**c) for c in m.citations],
        create_time=_ts(m.created_at),
    )


def _citation_to_dict(c: chat_pb2.Citation) -> dict:
    return {
        "document_id": c.document_id,
        "document_title": c.document_title,
        "chunk_index": c.chunk_index,
        "snippet": c.snippet,
        "score": c.score,
    }
