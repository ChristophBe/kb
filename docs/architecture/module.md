# Module architecture

Every module in `modules/<id>/` follows this architecture, whatever its language. It builds on the folder layout from [ADR 0002](../adr/0002-module-per-folder-monorepo.md) and is decided in [ADR 0008](../adr/0008-reference-module-architecture.md). How the modules fit together is in the [overview](overview.md); code-level conventions are in the [coding standards](../coding-standards.md).

**Reference implementations:** `document` for Go (`modules/document/service`) and `llm` for Python (`modules/llm/service`). Start a new module by copying the structure of the matching one. Gaps between the existing modules and this document are tracked as issues; see [Known deviations](#known-deviations).

## Layers

```mermaid
flowchart LR
    contract["Contract<br/>proto/kb/&lt;id&gt;/v1"]
    transport["Transport<br/>gRPC handlers, event consumers"]
    app["Application logic<br/>use cases, ports"]
    adapters["Adapters<br/>store, storage, providers,<br/>peer clients, event publishers"]
    wiring["Wiring<br/>main / __main__"]

    transport --> contract
    transport --> app
    app --> contract
    adapters -. implement ports .-> app
    wiring --> transport
    wiring --> adapters
```

| Layer | Responsibility | May depend on | Must not |
|---|---|---|---|
| **Contract** (`proto/`) | RPCs and event messages: the module's only public surface. | `kb.common.v1`, well-known types | Contain logic |
| **Transport** | Decode requests, validate input shape, call application logic, encode responses, map errors to gRPC status. Event consumers decode messages and call the same logic. | Contract, application | Talk to a database, bucket or peer directly |
| **Application** | Use cases: rules, orchestration across adapters, state transitions. Declares the **ports** (interfaces) it needs. | Contract types, its own ports, generated client interfaces of declared peers | Import gRPC status/codes, SQL, S3 or HTTP clients |
| **Adapters** | Implement ports: sqlc store, S3, LLM providers, publishers, other modules' clients. | Infrastructure libraries, `platform/` | Contain business rules |
| **Wiring** | Load config, set up logging, connect infrastructure, build adapters, register servers, run. | Everything in the module, `platform/` | Contain logic beyond construction |

**Collapsing transport and application** is allowed while every handler is validation plus a single adapter call (the `document` service today): the logic stays in the `server` package. As soon as a use case orchestrates two or more adapters, or is shared by a gRPC handler and an event consumer, it moves into the application package.

Errors cross layers as values, not as gRPC statuses: application code returns typed errors (Go: sentinel errors such as `app.ErrNotFound`, `errors.Is`; Python: exception classes in the application module), and transport maps them once.

## Layout

| | Go (`service/`) | Python (`service/` or `worker/`) |
|---|---|---|
| Wiring | `cmd/<module>-service/main.go`: `Config` struct, `run()`, `healthcheck` subcommand | `src/kb_<component>/__main__.py`: `run()` and `main()` |
| Config | `Config` in `main.go`, embedding `config.Base` (`platform/go/config`) | `config.py`: `Settings(PlatformSettings)` (`kb_platform.config`) |
| Transport | `internal/server` (gRPC), `internal/events` (consumers) | `server.py` (servicer); consumer loop in `__main__.py` for workers |
| Application | `internal/app` (or inside `internal/server` while collapsed) | `<use case>.py` modules, e.g. `chat.py`, `worker.py` (`Processor`) |
| Ports | Interfaces in the consuming package (`server.Repository`, `server.ObjectStore`) | `Protocol` classes in the consuming module, or a `ports.py` |
| Adapters | `internal/store` (sqlc + hand-written `repo.go`), `internal/storage`, `internal/events` (publisher) | `db.py` / `repository.py`, `providers/` with a `REGISTRY` |
| Migrations | `migrations/*.sql` (goose), embedded via `migrations.go` | `migrations/versions/*.py` (Alembic) |
| Tests | `*_test.go` next to the code, fakes embed the port interface | `tests/` per component, fakes implement the `Protocol` |

A module with a Go service and a Python worker (ingestion) applies both columns, one per component. Generated code (`api/`, sqlc `internal/store/*.go` except `repo.go`) is an adapter detail and is never edited.

## Runtime conventions

- **Configuration:** `KB_*` environment variables only, read through the platform config helpers. Every setting has a default that works for local development (`localhost` addresses); compose overrides them. Peer addresses are `KB_<MODULE>_ADDR`. Settings that must match another module (e.g. `KB_EMBEDDING_DIMENSIONS`) are documented on both sides.
- **Logging:** `platform/go/logging` (`slog`) and `kb_platform.logging`; JSON by default, the `service` field set to the component name. Log errors once, where they are handled.
- **Health:** every gRPC server exposes the standard `grpc.health.v1` service via `platform/go/grpcserver` or `kb_platform.grpc.serve`, and a `healthcheck` entry point used by compose (`/app healthcheck`, `python -m kb_platform.healthcheck <port>`). A service reports `SERVING` once **its own** infrastructure (database, bucket, stream) is ready and `NOT_SERVING` while shutting down. Peer modules never affect its health. Workers have no gRPC port and no health endpoint; compose restarts them when they exit.
- **gRPC status mapping** (done once, in transport):

  | Situation | Status |
  |---|---|
  | Malformed or missing input | `INVALID_ARGUMENT` |
  | Unknown id (including malformed ids, where it doesn't leak information) | `NOT_FOUND` |
  | Valid request in the wrong state ("upload already completed") | `FAILED_PRECONDITION` |
  | A peer module or the module's own infrastructure is unreachable | `UNAVAILABLE` |
  | Overload, limits reached | `RESOURCE_EXHAUSTED` |
  | Anything else | `INTERNAL` with a generic message (`"<op> failed"`); the cause is logged |

  A peer's status is never passed through unchanged: a peer's `NOT_FOUND` means something different from this module's `NOT_FOUND`. Map peer `UNAVAILABLE` / `DEADLINE_EXCEEDED` to `UNAVAILABLE`, and everything else to `INTERNAL`, unless the use case defines a better mapping.

  A streaming RPC that has already sent results may instead end with an error event in its stream, using the same codes and a readable message, so the results so far are kept (`ChatService.StreamChat`).

## Talking to other modules

- Only through the peer's **generated gRPC client** (`modules/<peer>/api/{go,python,ts}`) or by **consuming its events** (stream owned by the peer, messages from its proto package). Never its database schema, bucket, stream configuration or internal packages.
- Peers are **soft dependencies**. A module starts, migrates and reports healthy without them. Clients are created lazily (`grpc.NewClient`, `grpc.aio.insecure_channel` don't connect at construction) and calls that need an unavailable peer fail with `UNAVAILABLE`. RPCs that don't need the peer keep working. Compose files declare `depends_on` only for infrastructure, never for other modules' services.
- Event consumers are idempotent (at-least-once delivery, [ADR 0004](../adr/0004-nats-jetstream-events-between-modules.md)) and treat a peer outage as a transient error: they NAK and retry rather than fail the work permanently.
- Publishing an event that another module consumes makes it part of the contract; it follows the same compatibility rules as RPCs (`buf breaking`).

## Declared dependencies

`module.yaml` lists what a module uses from other modules:

```yaml
depends_on: [document, llm]       # modules whose contract (RPCs or events) this module uses
consumes:                         # event subjects this module subscribes to
  - kb.ingestion.uploaded
```

- `depends_on` names modules, not services. A module may import another module's `api/` package only if it is listed. The graph must be acyclic: if two modules need each other, one of them talks through events.
- `consumes` lists every subject the module subscribes to (its own included). Each subject must belong to the module itself or to a module in `depends_on`.
- `tools/modgen` (`task gen`) validates both fields (unknown or duplicate modules, cycles, subjects of undeclared modules) and generates the import-boundary rules from them.

### Enforcement

`task lint` fails when a module imports anything but its own code, `platform/` and the `api/` of a module in its `depends_on`, or when `platform/` imports a module:

| Language | Tool | Generated config |
|---|---|---|
| Go | golangci-lint `depguard` | `.golangci.yml` (from `tools/modgen/templates/golangci.yml.tmpl`) |
| Python | `lint-imports` (import-linter) | `.importlinter` |
| TypeScript | biome `noRestrictedImports` overrides | `biome.modules.jsonc`, extended by `biome.json` |

Relative TypeScript imports may go up at most two levels, so they stay inside the package. `task test:boundaries` (part of `task test`) checks that each tool rejects the violations in `tools/modgen/testdata/boundaries` and nothing else.

## UI package

- `modules/<id>/ui` is the npm package `@kb/module-<id>`, named in `module.yaml` under `ui`. `src/index.tsx` default-exports `defineModule({ id, title, icon, routes, nav?, widgets? })` from `@kb/module-sdk`; `id` matches the manifest. The shell mounts the routes under `/m/<id>` and lists the nav items.
- One file per page component (`DocumentList.tsx`, `DocumentDetail.tsx`); small helpers in camelCase files (`status.ts`).
- Data access: `useClient(<Service>)` with `useQuery` / `useMutation` from `@kb/module-sdk`, using the module's own `@kb/<id>-api` package or a declared peer's. No hand-rolled `fetch`, no transport setup.
- Components and styling come from `@kb/ui` and the design tokens ([UX standards](../ux-standards.md)). A module UI never imports another module's UI package; cross-module links are plain routes (`/m/document/<id>`).

## Known deviations

Gaps between the existing modules and this document, each tracked as an issue under the module's epic:

| Module | Gap | Issue |
|---|---|---|
| chat | None found | — |
| document | None found | — |
