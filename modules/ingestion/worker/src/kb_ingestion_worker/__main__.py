import asyncio
import contextlib
import logging
import signal

from google.protobuf.message import Message
from kb.document.v1 import document_pb2_grpc
from kb.llm.v1 import llm_pb2_grpc
from kb_platform.grpc import channel, is_serving
from kb_platform.logging import setup_logging
from kb_platform.nats import connect, ensure_stream
from nats.aio.msg import Msg
from nats.js.api import AckPolicy, ConsumerConfig
from nats.js.errors import Error as JetStreamError

from .config import Settings
from .worker import STREAM, SUBJECT_UPLOADED, PeerGate, Processor, deliver

CONSUMER = "ingestion-worker"

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
        config = ConsumerConfig(
            name=CONSUMER,
            durable_name=CONSUMER,
            filter_subject=SUBJECT_UPLOADED,
            ack_policy=AckPolicy.EXPLICIT,
            # Embedding large documents can take a while on CPU-only Ollama.
            ack_wait=600,
            max_deliver=settings.max_deliver,
        )
        # Creates the consumer, or updates one made by an earlier version (which
        # pull_subscribe would reuse unchanged). The server's value is the one
        # that decides which delivery is the last.
        try:
            await js.add_consumer(STREAM, config)
        except JetStreamError as err:
            log.warning("could not update consumer %s: %s", CONSUMER, err)
        info = await js.consumer_info(STREAM, CONSUMER)
        max_deliver = info.config.max_deliver or settings.max_deliver
        sub = await js.pull_subscribe_bind(durable=CONSUMER, stream=STREAM)

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
                await deliver(processor, _Delivery(msg), max_deliver)

    await nc.drain()


class _Delivery:
    """Adapts a JetStream message to worker.Delivery."""

    def __init__(self, msg: Msg) -> None:
        self._msg = msg
        self.data = msg.data

    @property
    def num_delivered(self) -> int:
        return self._msg.metadata.num_delivered or 1

    async def ack(self) -> None:
        await self._msg.ack()

    async def nak(self, delay: float | None = None) -> None:
        await self._msg.nak(delay=delay)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
