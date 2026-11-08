import asyncio
import logging

from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.document.v1 import document_pb2_grpc
from kb.llm.v1 import llm_pb2_grpc
from kb_platform.grpc import channel, serve
from kb_platform.logging import setup_logging
from kb_platform.telemetry import setup_tracing
from sqlalchemy.ext.asyncio import create_async_engine

from .chat import Chat
from .config import Settings
from .db import SqlRepository, migrate
from .manual import Manual, load_sections
from .peers import PeerEmbedder, PeerGenerator, PeerRetriever
from .server import ChatServicer

log = logging.getLogger("kb_chat")


async def run() -> None:
    settings = Settings()
    setup_logging(settings.log_level, settings.log_format)
    setup_tracing(settings.otel_endpoint, "chat-service")
    await migrate(settings.database_url)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with channel(settings.document_addr) as doc_ch, channel(settings.llm_addr) as llm_ch:
            repo = SqlRepository(engine)
            documents = document_pb2_grpc.DocumentServiceStub(doc_ch)
            llm = llm_pb2_grpc.LlmServiceStub(llm_ch)
            manual = Manual(
                load_sections(settings.manual_dir),
                settings.manual_top_k,
                settings.manual_min_score,
            )
            # In the background: chat answers without the manual until the llm
            # module has embedded it.
            loading = asyncio.create_task(manual.load(PeerEmbedder(llm)))
            retriever = PeerRetriever(documents, llm, manual, settings.rag_min_score)
            chat = Chat(settings, repo, retriever, PeerGenerator(llm))
            servicer = ChatServicer(repo, chat)
            try:
                await serve(
                    settings.grpc_port,
                    [lambda s: chat_pb2_grpc.add_ChatServiceServicer_to_server(servicer, s)],
                    [chat_pb2.DESCRIPTOR.services_by_name["ChatService"].full_name],
                )
            finally:
                loading.cancel()
    finally:
        await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
