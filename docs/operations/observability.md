# Observability

## Tracing

Every component can send [OpenTelemetry](https://opentelemetry.io) traces over OTLP/gRPC. Tracing is **off** unless `KB_OTEL_ENDPOINT` is set; without it nothing is installed (no exporter, no background goroutine or thread, no interceptor). The service name in the traces is the component's (`ingestion-service`, `ingestion-worker`, `document-service`, `llm-service`, `chat-service`). See [ADR 0010](../adr/0010-opentelemetry-tracing.md).

### Running with Jaeger

The compose profile `observability` starts an OpenTelemetry collector (`otel-collector`, config in `deploy/otel/collector.yaml`) and [Jaeger](https://www.jaegertracing.io) behind it. A profile can't set the services' environment, so point them at the collector as well:

```sh
KB_OTEL_ENDPOINT=http://otel-collector:4317 task up -- --profile observability
open http://localhost:16686   # Jaeger UI
```

or put both into `.env` to have them on for every `task up`:

```sh
KB_OTEL_ENDPOINT=http://otel-collector:4317
COMPOSE_PROFILES=observability
```

| Setting | Default | |
|---|---|---|
| `KB_OTEL_ENDPOINT` | empty (off) | OTLP/gRPC endpoint of every component, e.g. `http://otel-collector:4317`; `http://` sends without TLS |
| `KB_JAEGER_PORT` | `16686` | Host port of the Jaeger UI and API |
| `KB_OTEL_GRPC_PORT` | `4317` | Host port of the collector's OTLP/gRPC receiver, for components run outside compose (`KB_OTEL_ENDPOINT=http://localhost:4317`) |

Jaeger keeps traces in memory; they are gone after a restart. To send traces elsewhere (Tempo, a hosted backend), add an exporter to the collector config, or set `KB_OTEL_ENDPOINT` to that backend's OTLP/gRPC endpoint directly.

### What is traced

- **gRPC**, server and client side: `platform/go/grpcserver` (`New`, `Dial`, via `otelgrpc` stats handlers) and `kb_platform.grpc` (`serve`, `channel`, via `opentelemetry-instrumentation-grpc`). Health checks are left out.
- **Postgres** queries of the Go services (`platform/go/postgres.Connect`, via `otelpgx`).
- **NATS messages**: publishers put the W3C trace context (`traceparent`, `tracestate`) into the message headers in a `send <subject>` producer span, and consumers continue it in a `process <subject>` consumer span (Go `natsx.Publish` / `natsx.Receive`, Python `kb_platform.nats.publish` / `receive`). A new publisher or consumer uses these helpers, so its messages stay in the trace.

So completing an upload gives one trace: the `CompleteUpload` call on `ingestion-service` with its call to `document-service`, the `kb.ingestion.uploaded` message to `ingestion-worker`, the worker's calls to `document-service` and `llm-service` (`ReadContent`, `Embed`, `AddChunks`, …) and its started/progress/processed events, which `ingestion-service` applies to the job. Envoy doesn't trace yet, so each call from the browser starts a new trace.

### Trace ids in logs

Log lines written while handling a traced request carry `trace_id` and `span_id` (Go: `platform/go/logging`, for records logged with a context; Python: `kb_platform.logging`). Search Jaeger for a trace id from a log line (*Search* → *Trace ID*), or `docker compose logs | grep <trace id>` for all log lines of a trace.
