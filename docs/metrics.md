# Metrics

Every component serves Prometheus metrics at `/metrics` on its own port, apart from the gRPC port; scraping needs no token. Why native Prometheus clients: [ADR 0012](adr/0012-prometheus-metrics-with-native-clients.md). Running Prometheus locally: [Observability](operations/observability.md#metrics).

| Component | Metrics port (`KB_METRICS_PORT`) |
|---|---|
| `document-service` | 9101 |
| `ingestion-service` | 9102 |
| `chat-service` | 9103 |
| `llm-service` | 9104 |
| `ingestion-worker` | 9105 |

The default is `metrics_port` in the module's `module.yaml`; compose publishes it on the same host port, the Helm chart as the container and Service port `metrics`.

Labels never carry user, document or job ids, so the number of series stays small. A metric's name and labels are an interface for dashboards and alerts: change them only together with this page.

## gRPC servers

Recorded for every RPC except health checks by `platform/go/grpcserver` and `kb_platform.grpc.serve`, with the same names and labels in Go and Python.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `grpc_server_handled_total` | counter | `grpc_type`, `grpc_service`, `grpc_method`, `grpc_code` | RPCs completed by the server |
| `grpc_server_handling_seconds` | histogram | `grpc_type`, `grpc_service`, `grpc_method` | Time to complete an RPC; for streams until the last message |

- `grpc_type`: `unary`, `server_stream`, `client_stream` or `bidi_stream`.
- `grpc_service`, `grpc_method`: e.g. `kb.document.v1.DocumentService`, `SearchChunks`.
- `grpc_code`: the status code as Go spells it: `OK`, `NotFound`, `InvalidArgument`, `Unavailable`, `ResourceExhausted`, `Canceled`, …

Error rate of a service: `sum by (grpc_method) (rate(grpc_server_handled_total{job="document-service", grpc_code!="OK"}[5m]))`.

## Ingestion

### ingestion-service

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `kb_ingestion_job_transitions_total` | counter | `status` | Jobs that entered a status. Redelivered events don't count twice: only real changes do. |
| `kb_ingestion_jobs` | gauge | `status` | Jobs per status in the database, counted at each scrape. Every replica reports the same totals, so aggregate with `max`, not `sum`. While the database is down the metric is missing from the scrape. |

`status`: `pending_upload` (created, waiting for the file), `queued`, `processing`, `done`, `failed`. The queue depth is `kb_ingestion_jobs{status="queued"}`.

### ingestion-worker

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `kb_ingestion_worker_jobs_total` | counter | `outcome` | Processing attempts of uploads |
| `kb_ingestion_worker_job_duration_seconds` | histogram | `outcome` | Time of one attempt: download, extraction, chunking, embedding and storing |
| `kb_ingestion_worker_jobs_in_progress` | gauge | | Uploads the worker is processing right now (at most `KB_WORKER_CONCURRENCY`) |
| `kb_ingestion_worker_chunks_total` | counter | | Chunks stored for processed uploads |

`outcome`: `processed`, `failed` (for good) or `retried` (a transient error such as an unavailable peer; the upload is delivered again later).

## Models (llm-service)

Recorded for successful calls only, so `model` holds models the provider actually has; failed calls show up in the gRPC metrics by status code. `provider` is the provider serving the task (`ollama`, `anthropic`, `fake`).

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `kb_llm_generation_duration_seconds` | histogram | `provider`, `model` | Time of a `Generate` call from the request to the last token |
| `kb_llm_generation_first_token_seconds` | histogram | `provider`, `model` | Time from a `Generate` request to its first token |
| `kb_llm_tokens_total` | counter | `provider`, `model`, `direction` | Generation tokens as the provider reports them; `direction` is `input` (prompt, including cached input for Anthropic) or `output` |
| `kb_llm_embedding_duration_seconds` | histogram | `provider`, `model` | Time an `Embed` call took at the provider, for all its inputs |
| `kb_llm_embedding_inputs_total` | counter | `provider`, `model` | Texts embedded. The provider interface reports no token counts for embeddings. |

Output tokens per second, by model: `sum by (model) (rate(kb_llm_tokens_total{direction="output"}[5m]))`. Mean time per answer: `rate(kb_llm_generation_duration_seconds_sum[5m]) / rate(kb_llm_generation_duration_seconds_count[5m])`.

## Runtime

The client libraries add their standard runtime metrics: Go `go_*` (goroutines, GC, memory) and `process_*` (CPU, memory, open files); Python `process_*` and `python_gc_*`, `python_info`.
