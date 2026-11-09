"""NATS connections and JetStream streams. With tracing on
(`kb_platform.telemetry`), `publish` and `receive` carry the trace of a request
across messages in their W3C trace context headers."""

import contextlib
from collections.abc import Iterator, Mapping

import nats
from nats.aio.client import Client
from nats.js import JetStreamContext
from nats.js.api import StreamConfig
from nats.js.errors import NotFoundError
from opentelemetry import propagate, trace

from kb_platform import telemetry

_tracer = trace.get_tracer(__name__)


async def connect(url: str, name: str) -> Client:
    return await nats.connect(url, name=name, max_reconnect_attempts=-1)


async def ensure_stream(js: JetStreamContext, name: str, subjects: list[str]) -> None:
    """Create the stream if missing. Streams are owned by the module whose
    subjects they carry; any of its components may call this at startup."""
    try:
        await js.stream_info(name)
    except NotFoundError:
        await js.add_stream(StreamConfig(name=name, subjects=subjects))


async def publish(
    js: JetStreamContext, subject: str, payload: bytes, headers: dict[str, str] | None = None
) -> None:
    """Publishes to JetStream. With tracing on it does so in a producer span
    whose context goes into the headers, so that the consumer continues the
    trace (see `receive`)."""
    if not telemetry.enabled():
        await js.publish(subject, payload, headers=headers)
        return
    with _tracer.start_as_current_span(
        f"send {subject}", kind=trace.SpanKind.PRODUCER, attributes=_attributes(subject, "send")
    ):
        headers = dict(headers or {})
        propagate.inject(headers)
        await js.publish(subject, payload, headers=headers)


@contextlib.contextmanager
def receive(subject: str, headers: Mapping[str, str] | None) -> Iterator[None]:
    """Runs the block handling a message: with tracing on, in a consumer span
    continuing the trace of the message's publisher."""
    if not telemetry.enabled():
        yield
        return
    with _tracer.start_as_current_span(
        f"process {subject}",
        context=propagate.extract(dict(headers or {})),
        kind=trace.SpanKind.CONSUMER,
        attributes=_attributes(subject, "process"),
    ):
        yield


def _attributes(subject: str, operation: str) -> dict[str, str]:
    return {
        "messaging.system": "nats",
        "messaging.destination.name": subject,
        "messaging.operation.type": operation,
    }
