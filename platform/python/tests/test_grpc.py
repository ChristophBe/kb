from collections.abc import Awaitable, Callable
from typing import Any

import grpc
import pytest
from google.rpc import error_details_pb2
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_status import rpc_status
from kb_platform.grpc import (
    abort_invalid_argument,
    abort_with_details,
    error_info,
    field_violations,
    is_serving,
    violation,
)


async def test_is_serving_reports_health_status() -> None:
    server = grpc.aio.server()
    servicer = health.aio.HealthServicer()  # pyright: ignore[reportAttributeAccessIssue]
    health_pb2_grpc.add_HealthServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        await servicer.set("", health_pb2.HealthCheckResponse.SERVING)
        assert await is_serving(ch)
        await servicer.set("", health_pb2.HealthCheckResponse.NOT_SERVING)
        assert not await is_serving(ch)
    await server.stop(None)


async def test_is_serving_is_false_when_unreachable() -> None:
    # Port 9 (discard) has no gRPC server; the call fails fast.
    async with grpc.aio.insecure_channel("127.0.0.1:9") as ch:
        assert not await is_serving(ch, rpc_timeout=0.5)


async def _call_failing(handler: Callable[[bytes, Any], Awaitable[bytes]]) -> grpc.aio.AioRpcError:
    """Calls a unary method implemented by `handler` and returns its error."""
    server = grpc.aio.server()
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "test.Svc", {"Call": grpc.unary_unary_rpc_method_handler(handler)}
            ),
        )
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
            with pytest.raises(grpc.aio.AioRpcError) as exc:
                await ch.unary_unary("/test.Svc/Call")(b"")
            return exc.value
    finally:
        await server.stop(None)


async def test_abort_invalid_argument_carries_field_violations() -> None:
    async def handler(_request: bytes, context: Any) -> bytes:
        await abort_invalid_argument(
            context,
            violation("title", "Title must not be empty"),
            violation("document_ids[0]", "Invalid document id 'x'"),
        )

    err = await _call_failing(handler)
    assert err.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert err.details() == "Title must not be empty; Invalid document id 'x'"
    assert [(v.field, v.description) for v in field_violations(err)] == [
        ("title", "Title must not be empty"),
        ("document_ids[0]", "Invalid document id 'x'"),
    ]


async def test_abort_with_details_carries_error_info() -> None:
    async def handler(_request: bytes, context: Any) -> bytes:
        await abort_with_details(
            context,
            grpc.StatusCode.FAILED_PRECONDITION,
            "wrong state",
            error_info("kb.test.v1", "WRONG_STATE", {"id": "1"}),
        )

    err = await _call_failing(handler)
    assert err.code() == grpc.StatusCode.FAILED_PRECONDITION
    status = rpc_status.from_call(err)  # pyright: ignore[reportArgumentType]
    assert status is not None
    info = error_details_pb2.ErrorInfo()
    assert status.details[0].Unpack(info)
    assert (info.domain, info.reason) == ("kb.test.v1", "WRONG_STATE")
    assert dict(info.metadata) == {"id": "1"}
    assert field_violations(err) == []


async def test_field_violations_of_a_plain_error() -> None:
    async def handler(_request: bytes, context: Any) -> bytes:
        await context.abort(grpc.StatusCode.NOT_FOUND, "missing")
        raise AssertionError("abort raises")

    assert field_violations(await _call_failing(handler)) == []
