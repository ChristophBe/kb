# kb — modular knowledge management

Monorepo organised **by module, not by language**. Read README.md for the overview.

## Module anatomy (`modules/<id>/`)
- `module.yaml` — manifest (services, ports, routed gRPC services, UI package). Source of truth for wiring.
- `proto/kb/<id>/v1/*.proto` — the module's public contract (incl. its NATS event messages).
- `api/{go,python,ts}` — **generated** bindings (committed). Never edit; run `task gen`.
- `service/` (Go or Python), `worker/` (optional), `migrations/`, `ui/`, `compose.yaml`.

Shared, module-agnostic code lives in `platform/` (`go/`, `python/`, `ui/`, `proto/` for kb.common.v1). `platform/` must never import a module.

## Rules
- Changing a proto, a `module.yaml`, or SQL queries → `task gen` and commit the output (CI fails on drift).
- Modules talk to each other only via the other module's generated gRPC client or its events. Never read another module's DB schema, bucket or stream.
- Only the `llm` module talks to LLM vendors. Add a provider in `modules/llm/service/src/kb_llm/providers/` and register it in `REGISTRY`.
- Generated / `DO NOT EDIT` files: `modules/*/api/**`, `platform/api/**`, `**/buf.gen.yaml`, `**/internal/store/*.go` (sqlc, except `repo.go`), `compose.yaml`, `deploy/envoy/envoy.yaml`, `apps/web/src/modules.gen.ts`.
- The embedding dimension (768) appears in `modules/document/migrations` and `KB_EMBEDDING_DIMENSIONS`; change both together via a new migration.

## Issues
Backlog lives in GitHub issues: epics (`type:epic`) per module with sub-issues, milestones M1–M3. Conventions in CONTRIBUTING.md.

## Commands (`task` = `go tool -modfile=tools/go.mod task` if not installed)
- `task setup` · `task gen` · `task lint` · `task test` · `task ci`
- `task up` (stack) · `task up -- --profile ollama` · `task down` · `task dev` (hot reload) · `task web` (Vite)
- Python tests run per component with `--rootdir <component>` (a repo-root rootdir would make pytest shadow the stdlib `platform` module).
- In zsh, don't put multi-word commands in a variable (`$G args`); no word splitting.
