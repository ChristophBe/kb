"""Ingestion events the curation module reacts to."""

import asyncio
import datetime
import logging
import uuid
from typing import Protocol

from google.protobuf.message import DecodeError
from knowcel.ingestion.v1 import events_pb2
from knowcel_platform.nats import receive
from nats.errors import Error as NatsError
from nats.js import JetStreamContext
from nats.js.api import AckPolicy, ConsumerConfig
from nats.js.errors import Error as JetStreamError
from sqlalchemy.exc import SQLAlchemyError

from .curation import PeerError, Scorer
from .findings import Detector

STREAM = "INGESTION"
SUBJECT_PROCESSED = "knowcel.ingestion.processed"
CONSUMER = "curation-service"
# Seconds before a delivery is retried after a failure.
RETRY_DELAY = 30
# Deliveries of one event, after which JetStream drops it.
MAX_DELIVER = 10

log = logging.getLogger("knowcel_curation")


class Delivery(Protocol):
    data: bytes
    headers: dict[str, str] | None
    # When the event was published.
    timestamp: datetime.datetime

    async def ack(self) -> None: ...

    async def nak(self, delay: float | None = None) -> None: ...


async def deliver(scorer: Scorer, detector: Detector, msg: Delivery) -> None:
    """Scores the document of one processed event and looks for findings: ack
    when done, NAK with a delay to retry while the database or a peer module
    is unavailable."""
    try:
        event = events_pb2.DocumentProcessed.FromString(msg.data)
        document_id = uuid.UUID(event.document_id)
    except (DecodeError, ValueError):
        log.warning("ignoring a processed event that can't be read")
        await msg.ack()
        return
    processed_at = msg.timestamp
    if processed_at.tzinfo is None:
        processed_at = processed_at.replace(tzinfo=datetime.UTC)
    try:
        with receive(SUBJECT_PROCESSED, msg.headers):
            await scorer.on_processed(document_id, processed_at)
            if event.owner_id:
                await detector.detect(document_id, event.owner_id)
            else:
                log.info(
                    "no owner in the event of document %s: not looking for findings", document_id
                )
    except (SQLAlchemyError, PeerError):
        # Also a peer's refusal: it may be fixed by the time of a retry, and
        # JetStream drops the event after MAX_DELIVER deliveries.
        log.exception("handling document %s failed, retrying", document_id)
        await msg.nak(delay=RETRY_DELAY)
        return
    await msg.ack()


class _Message:
    """Adapts a JetStream message to Delivery."""

    def __init__(self, msg: object) -> None:
        self._msg = msg
        self.data = msg.data  # pyright: ignore[reportAttributeAccessIssue]
        self.headers = msg.headers  # pyright: ignore[reportAttributeAccessIssue]
        self.timestamp = msg.metadata.timestamp  # pyright: ignore[reportAttributeAccessIssue]

    async def ack(self) -> None:
        await self._msg.ack()  # pyright: ignore[reportAttributeAccessIssue]

    async def nak(self, delay: float | None = None) -> None:
        await self._msg.nak(delay=delay)  # pyright: ignore[reportAttributeAccessIssue]


async def consume(
    js: JetStreamContext, scorer: Scorer, detector: Detector, stop: asyncio.Event
) -> None:
    """Scores every processed document until `stop` is set. Deliveries are
    handled one at a time; scoring is a few queries."""
    await js.add_consumer(
        STREAM,
        ConsumerConfig(
            name=CONSUMER,
            durable_name=CONSUMER,
            filter_subject=SUBJECT_PROCESSED,
            ack_policy=AckPolicy.EXPLICIT,
            max_deliver=MAX_DELIVER,
        ),
    )
    sub = await js.pull_subscribe_bind(durable=CONSUMER, stream=STREAM)
    log.info("waiting for %s", SUBJECT_PROCESSED)
    while not stop.is_set():
        try:
            messages = await sub.fetch(10, timeout=2)
        except TimeoutError:
            continue
        except (NatsError, JetStreamError):
            # NATS is away or the consumer was recreated; try again shortly.
            log.exception("fetching processed events failed")
            await asyncio.sleep(RETRY_DELAY / 6)
            continue
        for msg in messages:
            try:
                await deliver(scorer, detector, _Message(msg))
            except Exception:
                log.exception("handling a processed event failed")
                await msg.nak(delay=RETRY_DELAY)
