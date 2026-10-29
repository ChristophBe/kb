import asyncio
import contextlib
import logging
import signal

from google.protobuf.message import Message
from kb.document.v1 import document_pb2_grpc
from kb.ingestion.v1 import events_pb2
from kb.llm.v1 import llm_pb2_grpc
from kb_platform.grpc import channel, is_serving
from kb_platform.logging import setup_logging
from kb_platform.nats import connect, ensure_stream
from nats.js.api import ConsumerConfig

from .config import Settings
from .worker import STREAM, SUBJECT_UPLOADED, PeerGate, Processor

log = logging.getLogger("kb_ingestion_worker")


async def run() -> None:
    settings = Settings()
    setup_logging(settings.log_level, settings.log_format)

    nc = await connect(settings.nats_url, "ingestion-worker")
    js = nc.jetstream()
    await ensure_stream(js, STREAM, ["kb.ingestion.>"])

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        await js.publish(subject, message.SerializeToString(), headers={"Nats-Msg-Id": dedupe_id})

    async with channel(settings.document_addr) as doc_ch, channel(settings.llm_addr) as llm_ch:
        processor = Processor(
            settings,
            document_pb2_grpc.DocumentServiceStub(doc_ch),
            llm_pb2_grpc.LlmServiceStub(llm_ch),
            publish,
        )
        sub = await js.pull_subscribe(
            SUBJECT_UPLOADED,
            durable="ingestion-worker",
            stream=STREAM,
            # Embedding large documents can take a while on CPU-only Ollama.
            config=ConsumerConfig(ack_wait=600, max_deliver=3),
        )

        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, stop.set)

        async def peers_serving() -> bool:
            return all(await asyncio.gather(is_serving(doc_ch), is_serving(llm_ch)))

        gate = PeerGate(peers_serving)
        log.info("waiting for %s", SUBJECT_UPLOADED)
        while not stop.is_set():
            if not await gate.is_open():
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=2)
                continue
            try:
                msgs = await sub.fetch(1, timeout=2)
            except TimeoutError:
                continue
            for msg in msgs:
                event = events_pb2.DocumentUploaded.FromString(msg.data)
                await processor.handle(event)
                await msg.ack()

    await nc.drain()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
