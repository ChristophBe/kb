import socket
import urllib.request
from collections.abc import AsyncIterator
from typing import Any

import grpc
import pytest
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from kb_platform.grpc import MetricsInterceptor
from kb_platform.metrics import start_metrics_server
from prometheus_client import REGISTRY


def _handled(service: str, method: str, code: str, kind: str = "unary") -> float:
    labels = {"grpc_type": kind, "grpc_service": service, "grpc_method": method, "grpc_code": code}
    return REGISTRY.get_sample_value("grpc_server_handled_total", labels) or 0


async def _ok(_request: bytes, _context: Any) -> bytes:
    return b"ok"


async def _missing(_request: bytes, context: Any) -> bytes:
    await context.abort(grpc.StatusCode.NOT_FOUND, "no such thing")
    raise AssertionError("unreachable: abort raises")


async def _broken(_request: bytes, _context: Any) -> bytes:
    raise RuntimeError("bug")


async def _stream(_request: bytes, _context: Any) -> AsyncIterator[bytes]:
    yield b"a"
    yield b"b"


async def test_metrics_interceptor_counts_calls_by_code() -> None:
    server = grpc.aio.server(interceptors=[MetricsInterceptor()])
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "test.Metrics",
                {
                    "Ok": grpc.unary_unary_rpc_method_handler(_ok),
                    "Missing": grpc.unary_unary_rpc_method_handler(_missing),
                    "Broken": grpc.unary_unary_rpc_method_handler(_broken),
                    "Stream": grpc.unary_stream_rpc_method_handler(_stream),
                },
            ),
        )
    )
    health_servicer = health.aio.HealthServicer()  # pyright: ignore[reportAttributeAccessIssue]
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    before = {
        m: _handled("test.Metrics", m, c)
        for m, c in [("Ok", "OK"), ("Missing", "NotFound"), ("Broken", "Unknown")]
    }
    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
            await ch.unary_unary("/test.Metrics/Ok")(b"")
            await ch.unary_unary("/test.Metrics/Ok")(b"")
            for name in ("Missing", "Broken"):
                with pytest.raises(grpc.aio.AioRpcError):
                    await ch.unary_unary(f"/test.Metrics/{name}")(b"")
            assert [r async for r in ch.unary_stream("/test.Metrics/Stream")(b"")] == [b"a", b"b"]
            await health_pb2_grpc.HealthStub(ch).Check(health_pb2.HealthCheckRequest())  # pyright: ignore[reportAttributeAccessIssue]
    finally:
        await server.stop(None)

    assert _handled("test.Metrics", "Ok", "OK") - before["Ok"] == 2
    assert _handled("test.Metrics", "Missing", "NotFound") - before["Missing"] == 1
    assert _handled("test.Metrics", "Broken", "Unknown") - before["Broken"] == 1
    assert _handled("test.Metrics", "Stream", "OK", kind="server_stream") == 1
    duration = REGISTRY.get_sample_value(
        "grpc_server_handling_seconds_count",
        {"grpc_type": "unary", "grpc_service": "test.Metrics", "grpc_method": "Ok"},
    )
    assert duration is not None
    assert duration >= 2
    assert _handled(health.SERVICE_NAME, "Check", "OK") == 0


def test_start_metrics_server_serves_metrics() -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    start_metrics_server(port)
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics") as resp:
        body = resp.read().decode()
    assert "# TYPE grpc_server_handled_total counter" in body
    assert "process_cpu_seconds_total" in body or "python_gc_objects_collected_total" in body
