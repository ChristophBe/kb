import asyncio
import logging

from kb.chat.v1 import chat_pb2, chat_pb2_grpc
from kb.document.v1 import document_pb2_grpc
from kb.llm.v1 import llm_pb2_grpc
from kb_platform.grpc import channel, serve
from kb_platform.logging import setup_logging
from sqlalchemy.ext.asyncio import create_async_engine

from .chat import Chat
from .config import Settings
from .db import SqlRepository, migrate
from .peers import PeerGenerator, PeerRetriever
from .server import ChatServicer

log = logging.getLogger("kb_chat")


async def run() -> None:
    settings = Settings()
    setup_logging(settings.log_level, settings.log_format)
    await migrate(settings.database_url)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with channel(settings.document_addr) as doc_ch, channel(settings.llm_addr) as llm_ch:
            repo = SqlRepository(engine)
            documents = document_pb2_grpc.DocumentServiceStub(doc_ch)
            llm = llm_pb2_grpc.LlmServiceStub(llm_ch)
            chat = Chat(settings, repo, PeerRetriever(documents, llm), PeerGenerator(llm))
            servicer = ChatServicer(repo, chat)
            await serve(
                settings.grpc_port,
                [lambda s: chat_pb2_grpc.add_ChatServiceServicer_to_server(servicer, s)],
                [chat_pb2.DESCRIPTOR.services_by_name["ChatService"].full_name],
            )
    finally:
        await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
