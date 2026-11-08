import json
import logging
import subprocess
import sys
import textwrap
from typing import Any

import grpc
import pytest
from kb_platform import telemetry
from kb_platform.grpc import channel
from kb_platform.logging import setup_logging
from kb_platform.nats import publish, receive
from opentelemetry import trace
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_tracing_is_off_without_endpoint() -> None:
    # In a fresh interpreter: tracing changes process-wide state once it is on.
    script = textwrap.dedent(
        """
        import json, sys, threading
        from kb_platform import telemetry
        before = threading.active_count()
        telemetry.setup_tracing("", "test")
        print(json.dumps({
            "enabled": telemetry.enabled(),
            "threads": threading.active_count() - before,
            "sdk_loaded": "opentelemetry.sdk.trace" in sys.modules,
            "interceptors": len(telemetry.server_interceptors() + telemetry.client_interceptors()),
        }))
        """
    )
    out = subprocess.run(
        [sys.executable, "-c", script], check=True, capture_output=True, text=True
    ).stdout
    assert json.loads(out) == {
        "enabled": False,
        "threads": 0,
        "sdk_loaded": False,
        "interceptors": 0,
    }


@pytest.fixture(scope="module")
def spans() -> InMemorySpanExporter:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    telemetry.install(provider)
    return exporter


@pytest.fixture
def recorded(spans: InMemorySpanExporter) -> InMemorySpanExporter:
    spans.clear()
    return spans


def _by_kind(spans: tuple[ReadableSpan, ...], kind: trace.SpanKind) -> trace.SpanContext:
    """The context of the one span of that kind."""
    found = [s for s in spans if s.kind == kind]
    assert len(found) == 1, [s.name for s in spans]
    assert found[0].context is not None
    return found[0].context


def _parent(spans: tuple[ReadableSpan, ...], kind: trace.SpanKind) -> trace.SpanContext:
    found = [s.parent for s in spans if s.kind == kind]
    assert found[0] is not None
    return found[0]


async def test_channel_and_server_share_the_trace(recorded: InMemorySpanExporter) -> None:
    async def echo(request: bytes, _context: Any) -> bytes:
        return request

    server = grpc.aio.server(interceptors=telemetry.server_interceptors())
    server.add_generic_rpc_handlers(
        [
            grpc.method_handlers_generic_handler(
                "test.Echo", {"Echo": grpc.unary_unary_rpc_method_handler(echo)}
            )
        ]
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        async with channel(f"127.0.0.1:{port}") as ch:
            assert await ch.unary_unary("/test.Echo/Echo")(b"hi") == b"hi"
    finally:
        await server.stop(None)

    spans = recorded.get_finished_spans()
    client = _by_kind(spans, trace.SpanKind.CLIENT)
    assert _parent(spans, trace.SpanKind.SERVER).span_id == client.span_id
    assert _by_kind(spans, trace.SpanKind.SERVER).trace_id == client.trace_id


class _FakeJetStream:
    def __init__(self) -> None:
        self.headers: dict[str, str] | None = None

    async def publish(self, _subject: str, _payload: bytes, headers: dict[str, str]) -> None:
        self.headers = headers


async def test_messages_carry_the_trace(
    recorded: InMemorySpanExporter, capsys: pytest.CaptureFixture[str]
) -> None:
    js = _FakeJetStream()
    await publish(js, "kb.test", b"", headers={"Nats-Msg-Id": "1"})  # type: ignore[arg-type]
    assert js.headers is not None
    assert js.headers["Nats-Msg-Id"] == "1"
    assert "traceparent" in js.headers

    setup_logging("INFO", "json")
    with receive("kb.test", js.headers):
        handling = trace.get_current_span().get_span_context()
        logging.getLogger("test").info("handling")

    spans = recorded.get_finished_spans()
    producer = _by_kind(spans, trace.SpanKind.PRODUCER)
    assert _by_kind(spans, trace.SpanKind.CONSUMER).trace_id == producer.trace_id
    assert _parent(spans, trace.SpanKind.CONSUMER).span_id == producer.span_id

    entry = json.loads(capsys.readouterr().err.splitlines()[-1])
    assert entry["trace_id"] == trace.format_trace_id(handling.trace_id)
    assert entry["span_id"] == trace.format_span_id(handling.span_id)
