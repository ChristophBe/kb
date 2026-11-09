from __future__ import annotations

import asyncio
import contextlib
import contextvars
import inspect
import logging
import signal
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Iterator, Mapping
from typing import Any, NoReturn

import grpc
from google.protobuf import any_pb2
from google.protobuf.message import Message
from google.rpc import error_details_pb2, status_pb2
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_reflection.v1alpha import reflection
from grpc_status import rpc_status

from kb_platform import metrics, telemetry

log = logging.getLogger(__name__)

Registrar = Callable[[grpc.aio.Server], None]

USER_HEADER = "x-kb-user"
"""Metadata key carrying the id of the calling user. Envoy sets it from the
subject of the verified token and drops any value the client sent, so services
can trust it on calls that came through the gateway."""

_user: contextvars.ContextVar[str | None] = contextvars.ContextVar("kb_user", default=None)


def current_user() -> str | None:
    """The id of the user the current RPC was made for, as put into the context
    by `UserInterceptor`; None for calls without a user, such as calls between
    services."""
    return _user.get()


@contextlib.contextmanager
def as_user(user: str) -> Iterator[None]:
    """Runs the block with `current_user()` returning `user`, for tests and
    code that acts on behalf of a user outside an RPC."""
    token = _user.set(user)
    try:
        yield
    finally:
        _user.reset(token)


class UserInterceptor(grpc.aio.ServerInterceptor):
    """Makes the x-kb-user metadata of each call available as `current_user()`
    inside its handler. `serve` installs it."""

    async def intercept_service(
        self,
        continuation: Callable[
            [grpc.HandlerCallDetails], Awaitable[grpc.RpcMethodHandler[Any, Any] | None]
        ],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> grpc.RpcMethodHandler[Any, Any] | None:
        handler = await continuation(handler_call_details)
        user = next(
            (
                str(value)
                for key, value in handler_call_details.invocation_metadata or ()
                if key == USER_HEADER and value
            ),
            None,
        )
        if handler is None or user is None:
            return handler
        return _with_user(handler, user)


def _with_user(
    handler: grpc.RpcMethodHandler[Any, Any], user: str
) -> grpc.RpcMethodHandler[Any, Any]:
    """Wraps the behaviour of `handler` so it runs with `current_user()` set."""

    @contextlib.asynccontextmanager
    async def scope(_context: Any) -> AsyncIterator[None]:
        with as_user(user):
            yield

    return _wrap(handler, scope)


_Scope = Callable[[Any], contextlib.AbstractAsyncContextManager[None]]


def _wrap(
    handler: grpc.RpcMethodHandler[Any, Any], scope: _Scope
) -> grpc.RpcMethodHandler[Any, Any]:
    """Wraps the behaviour of `handler` so each call runs inside
    `scope(context)`, streamed responses included."""

    def unary(behavior: Callable[..., Any]) -> Callable[..., Any]:
        async def run(request: Any, context: Any) -> Any:
            async with scope(context):
                return await behavior(request, context)

        return run

    def streaming(behavior: Callable[..., Any]) -> Callable[..., Any]:
        # Streaming handlers either yield their responses or write them with
        # context.write; keep the kind, grpc.aio treats the two differently.
        if not inspect.isasyncgenfunction(behavior):
            return unary(behavior)

        async def run(request: Any, context: Any) -> Any:
            async with scope(context):
                async for response in behavior(request, context):
                    yield response

        return run

    h: Any = handler
    if h.unary_unary:
        return grpc.unary_unary_rpc_method_handler(
            unary(h.unary_unary), h.request_deserializer, h.response_serializer
        )
    if h.unary_stream:
        return grpc.unary_stream_rpc_method_handler(
            streaming(h.unary_stream), h.request_deserializer, h.response_serializer
        )
    if h.stream_unary:
        return grpc.stream_unary_rpc_method_handler(
            unary(h.stream_unary), h.request_deserializer, h.response_serializer
        )
    return grpc.stream_stream_rpc_method_handler(
        streaming(h.stream_stream), h.request_deserializer, h.response_serializer
    )


# Status code names as Go's codes.Code.String() spells them, so both
# languages report the same grpc_code labels.
_CODE_NAMES = {
    grpc.StatusCode.OK: "OK",
    grpc.StatusCode.CANCELLED: "Canceled",
    grpc.StatusCode.UNKNOWN: "Unknown",
    grpc.StatusCode.INVALID_ARGUMENT: "InvalidArgument",
    grpc.StatusCode.DEADLINE_EXCEEDED: "DeadlineExceeded",
    grpc.StatusCode.NOT_FOUND: "NotFound",
    grpc.StatusCode.ALREADY_EXISTS: "AlreadyExists",
    grpc.StatusCode.PERMISSION_DENIED: "PermissionDenied",
    grpc.StatusCode.RESOURCE_EXHAUSTED: "ResourceExhausted",
    grpc.StatusCode.FAILED_PRECONDITION: "FailedPrecondition",
    grpc.StatusCode.ABORTED: "Aborted",
    grpc.StatusCode.OUT_OF_RANGE: "OutOfRange",
    grpc.StatusCode.UNIMPLEMENTED: "Unimplemented",
    grpc.StatusCode.INTERNAL: "Internal",
    grpc.StatusCode.UNAVAILABLE: "Unavailable",
    grpc.StatusCode.DATA_LOSS: "DataLoss",
    grpc.StatusCode.UNAUTHENTICATED: "Unauthenticated",
}
_CODES_BY_VALUE = {code.value[0]: code for code in grpc.StatusCode}


def _code_of(context: Any, default: grpc.StatusCode) -> str:
    """The status the handler set or aborted with, else `default`."""
    code = context.code()
    if isinstance(code, int):
        code = _CODES_BY_VALUE.get(code)
    return _CODE_NAMES.get(code or default, "Unknown")


class MetricsInterceptor(grpc.aio.ServerInterceptor):
    """Records grpc_server_handled_total and grpc_server_handling_seconds for
    every call except health checks (`kb_platform.metrics`). `serve` installs
    it."""

    async def intercept_service(
        self,
        continuation: Callable[
            [grpc.HandlerCallDetails], Awaitable[grpc.RpcMethodHandler[Any, Any] | None]
        ],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> grpc.RpcMethodHandler[Any, Any] | None:
        handler = await continuation(handler_call_details)
        full_method: str = handler_call_details.method or ""
        service, _, method = full_method.lstrip("/").partition("/")
        if handler is None or service == health.SERVICE_NAME:
            return handler
        h: Any = handler
        kind = (
            "unary"
            if h.unary_unary
            else "server_stream"
            if h.unary_stream
            else "client_stream"
            if h.stream_unary
            else "bidi_stream"
        )

        @contextlib.asynccontextmanager
        async def observed(context: Any) -> AsyncIterator[None]:
            start = time.perf_counter()
            code = "OK"
            try:
                yield
            except asyncio.CancelledError:
                code = "Canceled"
                raise
            except BaseException:
                # context.abort raises after setting the code; anything else is UNKNOWN.
                code = _code_of(context, grpc.StatusCode.UNKNOWN)
                raise
            else:
                code = _code_of(context, grpc.StatusCode.OK)
            finally:
                metrics.GRPC_HANDLED.labels(kind, service, method, code).inc()
                metrics.GRPC_HANDLING_SECONDS.labels(kind, service, method).observe(
                    time.perf_counter() - start
                )

        return _wrap(handler, observed)


async def serve(
    port: int,
    register: Iterable[Registrar],
    service_names: Iterable[str],
    *,
    grace_seconds: float = 5.0,
) -> None:
    """Run a grpc.aio server with health checking and reflection until SIGINT
    or SIGTERM. `service_names` are the fully qualified names reported as
    SERVING and exposed via reflection. Handlers read the calling user with
    `current_user()`. Each call is counted in the gRPC server metrics
    (`kb_platform.metrics`; serve them with `start_metrics_server`). With
    tracing on (`kb_platform.telemetry`), each call continues the caller's
    trace in a server span."""
    server = grpc.aio.server(
        interceptors=[MetricsInterceptor(), *telemetry.server_interceptors(), UserInterceptor()]
    )
    for reg in register:
        reg(server)

    names = list(service_names)
    health_servicer = health.aio.HealthServicer()  # pyright: ignore[reportAttributeAccessIssue]
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    for name in [*names, ""]:
        await health_servicer.set(name, health_pb2.HealthCheckResponse.SERVING)
    reflection.enable_server_reflection(
        [*names, health.SERVICE_NAME, reflection.SERVICE_NAME], server
    )

    server.add_insecure_port(f"[::]:{port}")
    await server.start()
    log.info("grpc server listening on :%d", port)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()

    log.info("shutting down")
    for name in [*names, ""]:
        await health_servicer.set(name, health_pb2.HealthCheckResponse.NOT_SERVING)
    await server.stop(grace_seconds)


class ForwardUserInterceptor(
    grpc.aio.UnaryUnaryClientInterceptor,
    grpc.aio.UnaryStreamClientInterceptor,
    grpc.aio.StreamUnaryClientInterceptor,
    grpc.aio.StreamStreamClientInterceptor,
):
    """Passes `current_user()`, if any, on to the called service as x-kb-user,
    so a call made while handling a user's RPC acts for that user. `channel`
    installs it."""

    async def intercept_unary_unary(
        self, continuation: Any, client_call_details: grpc.aio.ClientCallDetails, request: Any
    ) -> Any:
        return await continuation(_forward_user(client_call_details), request)

    async def intercept_unary_stream(
        self, continuation: Any, client_call_details: grpc.aio.ClientCallDetails, request: Any
    ) -> Any:
        return await continuation(_forward_user(client_call_details), request)

    async def intercept_stream_unary(
        self,
        continuation: Any,
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        return await continuation(_forward_user(client_call_details), request_iterator)

    async def intercept_stream_stream(
        self,
        continuation: Any,
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
    ) -> Any:
        return await continuation(_forward_user(client_call_details), request_iterator)


def _forward_user(details: grpc.aio.ClientCallDetails) -> grpc.aio.ClientCallDetails:
    user = current_user()
    if user is None:
        return details
    metadata = grpc.aio.Metadata(*(details.metadata or ()))
    metadata.add(USER_HEADER, user)
    return details._replace(metadata=metadata)  # pyright: ignore[reportAttributeAccessIssue]


def channel(target: str) -> grpc.aio.Channel:
    """Open an insecure channel to another module's service. Calls made while
    `current_user()` is set pass the user on (see `ForwardUserInterceptor`);
    calls without one, such as a worker's, reach the peer without a user. With
    tracing on, calls carry the current trace on to the peer."""
    return grpc.aio.insecure_channel(
        target, interceptors=[*telemetry.client_interceptors(), ForwardUserInterceptor()]
    )


async def is_serving(ch: grpc.aio.Channel, rpc_timeout: float = 2.0) -> bool:
    """Whether the server behind `ch` reports SERVING on the standard health
    service. An unreachable server is not serving; this never raises."""
    try:
        resp = await health_pb2_grpc.HealthStub(ch).Check(  # pyright: ignore[reportAttributeAccessIssue]
            health_pb2.HealthCheckRequest(), timeout=rpc_timeout
        )
    except grpc.aio.AioRpcError:
        return False
    return resp.status == health_pb2.HealthCheckResponse.SERVING


FieldViolation = error_details_pb2.BadRequest.FieldViolation


def violation(field: str, description: str) -> FieldViolation:
    """One invalid field of a request, for `abort_invalid_argument`. `field` is
    the field's path in the request message, in proto field names (see
    kb.common.v1); `description` is a sentence a user can act on."""
    return FieldViolation(field=field, description=description)


def error_info(
    domain: str, reason: str, metadata: Mapping[str, str] | None = None
) -> error_details_pb2.ErrorInfo:
    """A google.rpc.ErrorInfo detail: `reason` is a stable UPPER_SNAKE_CASE
    identifier clients may branch on, `domain` the proto package of the module
    that defines it (e.g. "kb.chat.v1")."""
    return error_details_pb2.ErrorInfo(domain=domain, reason=reason, metadata=metadata or {})


def status_with_details(code: grpc.StatusCode, message: str, *details: Message) -> grpc.Status:
    """A status carrying `details` in the grpc-status-details-bin trailer."""
    packed = []
    for detail in details:
        any_detail = any_pb2.Any()
        any_detail.Pack(detail)
        packed.append(any_detail)
    return rpc_status.to_status(
        status_pb2.Status(code=code.value[0], message=message, details=packed)
    )


async def abort_with_details(
    context: grpc.aio.ServicerContext[Any, Any],
    code: grpc.StatusCode,
    message: str,
    *details: Message,
) -> NoReturn:
    """Ends the RPC with `code`, `message` and the given error details."""
    status = status_with_details(code, message, *details)
    await context.abort(status.code, status.details, status.trailing_metadata)
    raise AssertionError("unreachable: abort raises")  # pragma: no cover


async def abort_invalid_argument(
    context: grpc.aio.ServicerContext[Any, Any], *violations: FieldViolation
) -> NoReturn:
    """Ends the RPC with INVALID_ARGUMENT and the violations as a
    google.rpc.BadRequest detail. The message joins the descriptions, so
    clients that ignore details still get a readable error."""
    await abort_with_details(
        context,
        grpc.StatusCode.INVALID_ARGUMENT,
        "; ".join(v.description for v in violations),
        error_details_pb2.BadRequest(field_violations=violations),
    )


def field_violations(err: grpc.aio.AioRpcError | grpc.RpcError) -> list[FieldViolation]:
    """The field violations carried by a failed call, if any."""
    status = rpc_status.from_call(err)  # pyright: ignore[reportArgumentType]
    if status is None:
        return []
    found: list[FieldViolation] = []
    for detail in status.details:
        if detail.Is(error_details_pb2.BadRequest.DESCRIPTOR):
            bad_request = error_details_pb2.BadRequest()
            detail.Unpack(bad_request)
            found.extend(bad_request.field_violations)
    return found
