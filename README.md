# kb — modular knowledge management

A modular knowledge-management system: ingest documents, manage them, and chat with them.

- **Go** — core infrastructure services (document, ingestion)
- **Python** — data-science / LLM work (ingestion worker, chat, llm gateway)
- **TypeScript + React** — a modular UI shell; each module ships its own UI package
- **gRPC + protobuf** between all modules; the browser uses gRPC-Web through Envoy
- **Static code generation** everywhere: buf (Go/Python/TS), sqlc (SQL), and `modgen` (wiring from module manifests)

## Modules

| Module | Components | What it does |
|---|---|---|
| `document` | Go service :9001 | Document metadata, raw files (S3), chunk + vector index (pgvector) |
| `ingestion` | Go service :9002, Python worker | Presigned uploads, job tracking, extract → chunk → embed pipeline over NATS JetStream |
| `chat` | Python service :9003 | Conversations, streaming retrieval-augmented answers with citations |
| `llm` | Python service :9004 | Single gateway to LLM providers (Ollama by default, `fake` for tests) |

```
browser ──gRPC-Web──▶ envoy :8080 ──gRPC──▶ document / ingestion / chat / llm
   │                                              │        │
   └── presigned PUT ──▶ S3 (SeaweedFS) :8333 ◀───┘        └─▶ NATS JetStream ──▶ ingestion-worker
                                     Postgres + pgvector (one schema per module)
```

Each module lives in `modules/<id>/` with its proto contract, generated API packages, backend, migrations, UI, and compose fragment. See [CLAUDE.md](CLAUDE.md) for the conventions, the [architecture overview](docs/architecture/overview.md) for diagrams of how the pieces fit together, and the [ADRs](docs/adr/README.md) for why.

## Prerequisites

Go ≥ 1.26, [uv](https://docs.astral.sh/uv/), Node 24 + pnpm, Docker. All other CLIs (buf, sqlc, goose, task, grpcurl) are pinned in `tools/go.mod` and run via `go tool`; no global install is needed:

```sh
alias task='go tool -modfile=tools/go.mod task'   # or install go-task
```

## Quick start

```sh
task setup                      # go/uv/pnpm dependencies
task up -- --profile ollama     # full stack incl. Ollama (pulls llama3.2 + nomic-embed-text)
open http://localhost:3000
```

No GPU or want a fast smoke test? Use `KB_LLM_PROVIDER=fake task up` (deterministic echo answers and hash embeddings). To use an Ollama running on the host (faster on macOS), set `KB_OLLAMA_URL=http://host.docker.internal:11434`. See `.env.example` for all settings, including the host ports if 8080/3000 are taken.

## Development

| Command | |
|---|---|
| `task gen` | Regenerate everything (module wiring, protobuf, sqlc) |
| `task lint` / `task test` | All languages |
| `task dev` | Stack with hot reload (`docker compose watch`) |
| `task web` | Vite dev server for the UI against the running stack |
| `task ci` | What CI runs (incl. a check that generated code is committed) |

### Adding a module

Follow the [module architecture](docs/architecture/module.md) and copy the structure of the reference implementation for your language (`document` for Go, `llm` for Python). A new module needs an ADR (see CONTRIBUTING.md).

1. Create `modules/<id>/module.yaml` and `modules/<id>/proto/kb/<id>/v1/<id>.proto`.
2. Add the backend under `modules/<id>/service` (and `compose.yaml`). For Python, also add it to the workspace members in `pyproject.toml`.
3. Optionally add `modules/<id>/ui` exporting a `KbModule` (see `platform/ui/module-sdk`), and add it as a dependency of `apps/web`.
4. `task gen`. This generates the API packages, Envoy routes, compose includes and the UI registry.
