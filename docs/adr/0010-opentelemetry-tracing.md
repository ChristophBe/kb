# 0010. Trace with OpenTelemetry, off unless configured

- Status: Accepted
- Date: 2026-11-08

## Context

An upload crosses ingestion-service, NATS, the ingestion worker, llm-service and document-service, in Go and Python. Finding out where it got slow or failed means reading the logs of five containers side by side. Options considered:

- **Correlation ids in logs only**: cheap, but gives no timing and no picture of the calls.
- **OpenTelemetry tracing**: vendor-neutral, with maintained gRPC instrumentation for Go and Python and a standard way to carry context in message headers (W3C Trace Context). Any OTLP backend works.
- **Tracing always on, exporting to a collector that may be missing**: one code path, but every service then runs an exporter and retries against nothing in development and tests.

## Decision

We will instrument the platform libraries with OpenTelemetry, so that modules get tracing without code of their own: gRPC servers and clients (`platform/go/grpcserver`, `kb_platform.grpc`), Go Postgres pools (`platform/go/postgres`) and NATS messages (`natsx.Publish`/`Receive`, `kb_platform.nats.publish`/`receive`, carrying W3C Trace Context in the headers). Log lines carry the trace and span id.

Tracing is off unless `KB_OTEL_ENDPOINT` (OTLP/gRPC) is set; while it is off no instrumentation, exporter or background work is installed. For development, the compose profile `observability` runs an OpenTelemetry collector forwarding to Jaeger (`deploy/infra.compose.yaml`, `deploy/otel/collector.yaml`).

## Consequences

- Services export to the collector, not to a backend; changing the backend, or adding metrics (#6) and logs pipelines, is collector configuration.
- Message publishers and consumers must go through the platform helpers, or the trace breaks at their messages.
- Envoy is not traced yet, so a trace starts at the first service, not at the browser.
- The Python gRPC instrumentation is a beta (`0.x`) release; it is pinned together with the SDK and upgraded as a set.
- Revisit if tracing should be sampled (now every request is traced once it is on).
