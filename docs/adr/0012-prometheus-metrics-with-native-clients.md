# 0012. Expose Prometheus metrics with the native client libraries

- Status: Accepted
- Date: 2026-11-09

## Context

There are no metrics: request rates and latencies, the ingestion queue and the time and tokens the models take are invisible. Every component (Go and Python, workers included) should expose them in one consistent way. Tracing already uses OpenTelemetry ([ADR 0010](0010-opentelemetry-tracing.md)), which anticipated adding metrics as a collector pipeline. Options considered:

- **OpenTelemetry metrics SDK, pushed over OTLP to the collector**: one telemetry stack. But the core collector image has no Prometheus exporter, so a Prometheus backend would need the contrib image or remote write; metrics would only exist while a collector runs; and the Python gRPC instrumentation records no metrics, so the Python servers would need hand-written instruments anyway.
- **OpenTelemetry metrics SDK with its Prometheus exporter** (pull): standard `/metrics` endpoints, but the Go and Python Prometheus exporters are pre-1.0 releases, OTel's semantic-convention names (`rpc.server.duration`, …) differ between instrumentation versions and translate oddly to Prometheus, and otelgrpc's metrics are tied to the tracing stats handler, which is off by default.
- **Native Prometheus clients** (`prometheus/client_golang`, `prometheus_client`): mature, widely used libraries and the de-facto standard for `/metrics`, with Go runtime and process metrics for free; the gRPC server metrics are small interceptors we write once per language.

## Decision

We will expose Prometheus metrics with the native client libraries: `platform/go/metrics` and `kb_platform.metrics` serve the default registry at `/metrics` on a separate port per component (`KB_METRICS_PORT`, default `metrics_port` from its `module.yaml`). The gRPC server interceptors in `platform/go/grpcserver` and `kb_platform.grpc` record `grpc_server_handled_total` and `grpc_server_handling_seconds` with identical names and labels in both languages (the names of go-grpc-prometheus, so existing dashboards fit). Modules add their domain metrics with the same libraries, named `kb_<module>_…`.

Metrics are always on: they cost little and need no backend. Prometheus scrapes them; for development the compose profile `observability` runs one, its scrape targets generated from the manifests (`deploy/prometheus/prometheus.yml`). The Helm chart exposes the port and sets the `prometheus.io/*` pod annotations.

Labels stay low-cardinality: methods, status codes, outcomes, providers and models, never user, document or job ids. `docs/metrics.md` lists every metric.

## Consequences

- Traces go through the OTLP collector, metrics are pulled by Prometheus: two paths, but each the standard one for its signal. The collector config keeps its single traces pipeline.
- Every component has a second port, declared as `metrics_port` in its manifest; `tools/modgen` checks that it exists and doesn't collide.
- A metric's name and labels are an interface for dashboards and alerts: renaming one is a breaking change and updates `docs/metrics.md`.
- Revisit if we want exemplars linking metrics to traces or a single OTLP pipeline for all signals; the instruments would then move to the OTel SDK.
