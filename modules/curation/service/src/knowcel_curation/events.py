"""Ingestion events the curation module reacts to."""

import asyncio
import datetime
import logging
import uuid
from typing import Protocol

from knowcel.ingestion.v1 import events_pb2
from knowcel_platform.nats import receive
from nats.js import JetStreamContext
from nats.js.api import AckPolicy, ConsumerConfig
from sqlalchemy.exc import SQLAlchemyError

from .curation import Scorer

STREAM = "INGESTION"
SUBJECT_PROCESSED = "knowcel.ingestion.processed"
CONSUMER = "curation-service"
# Seconds before a delivery is retried after a failure.
RETRY_DELAY = 30

log = logging.getLogger("knowcel_curation")


class Delivery(Protocol):
    data: bytes
    headers: dict[str, str] | None
    # When the event was published.
    timestamp: datetime.datetime

    async def ack(self) -> None: ...

    async def nak(self, delay: float | None = None) -> None: ...


async def deliver(scorer: Scorer, msg: Delivery) -> None:
    """Scores the document of one processed event: ack when done, NAK with a
    delay to retry while the database fails."""
    event = events_pb2.DocumentProcessed.FromString(msg.data)
    try:
        document_id = uuid.UUID(event.document_id)
    except ValueError:
        log.warning("ignoring a processed event with the document id %r", event.document_id)
        await msg.ack()
        return
    try:
        with receive(SUBJECT_PROCESSED, msg.headers):
            await scorer.on_processed(document_id, msg.timestamp)
    except SQLAlchemyError:
        log.exception("scoring document %s failed, retrying", document_id)
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


async def consume(js: JetStreamContext, scorer: Scorer, stop: asyncio.Event) -> None:
    """Scores every processed document until `stop` is set. Deliveries are
    handled one at a time; scoring is a few queries."""
    await js.add_consumer(
        STREAM,
        ConsumerConfig(
            name=CONSUMER,
            durable_name=CONSUMER,
            filter_subject=SUBJECT_PROCESSED,
            ack_policy=AckPolicy.EXPLICIT,
        ),
    )
    sub = await js.pull_subscribe_bind(durable=CONSUMER, stream=STREAM)
    log.info("waiting for %s", SUBJECT_PROCESSED)
    while not stop.is_set():
        try:
            messages = await sub.fetch(10, timeout=2)
        except TimeoutError:
            continue
        for msg in messages:
            try:
                await deliver(scorer, _Message(msg))
            except Exception:
                # Not acked: JetStream redelivers it after the ack wait.
                log.exception("handling a processed event failed")
