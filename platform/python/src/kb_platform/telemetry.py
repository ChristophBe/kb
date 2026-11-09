"""OpenTelemetry tracing. Tracing is off unless KB_OTEL_ENDPOINT is set: then
spans go to that OTLP/gRPC endpoint, and `kb_platform.grpc` and
`kb_platform.nats` instrument the servers, channels and messages they handle.
While it is off nothing is installed: no exporter, no background thread, no
interceptor."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from opentelemetry import trace

from kb_platform.version import version

if TYPE_CHECKING:
    from opentelemetry.sdk.trace import TracerProvider

_enabled = False


def enabled() -> bool:
    """Whether tracing is on, i.e. `setup_tracing` or `install` ran."""
    return _enabled


def setup_tracing(endpoint: str, service: str) -> None:
    """Exports the spans of `service` to the OTLP/gRPC `endpoint`, a URL such
    as http://otel-collector:4317. With an empty endpoint it does nothing.
    Call it before opening servers and channels. Buffered spans are flushed
    when the process exits."""
    if not endpoint:
        return
    # Imported here so that a component without tracing doesn't load the SDK.
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(
        resource=Resource.create({"service.name": service, "service.version": version()})
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    install(provider)


def install(provider: TracerProvider) -> None:
    """Makes `provider` the process's tracer provider, propagates W3C trace
    context and turns instrumentation on. `setup_tracing` calls it; tests pass
    a provider that records spans."""
    from opentelemetry import propagate
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.trace.propagation.tracecontext import (
        TraceContextTextMapPropagator,
    )

    global _enabled
    trace.set_tracer_provider(provider)
    propagate.set_global_textmap(
        CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()])
    )
    _enabled = True


def _not_health() -> Any:
    from opentelemetry.instrumentation.grpc import filters

    return filters.negate(filters.health_check())


def server_interceptors() -> list[Any]:
    """The interceptors that give each call of a grpc.aio server a span
    continuing the caller's trace; none while tracing is off. Health checks,
    which probes make every few seconds, are left out."""
    if not _enabled:
        return []
    from opentelemetry.instrumentation.grpc import aio_server_interceptor

    return [aio_server_interceptor(filter_=_not_health())]


def client_interceptors() -> list[Any]:
    """The interceptors that make a grpc.aio channel's calls carry the current
    trace on to the peer; none while tracing is off."""
    if not _enabled:
        return []
    from opentelemetry.instrumentation.grpc import aio_client_interceptors

    return aio_client_interceptors(filter_=_not_health())
