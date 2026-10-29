# Coding standards

Conventions for Go, Python and TypeScript in kb. Most of them are enforced by `task lint` and `task test`; the rest are checked in review. Where this doc and the code disagree, fix one of them in the same PR. Module structure (layers, packages, how modules call each other) is covered separately in the module architecture doc and the [ADRs](adr/README.md).

## All languages

- **Read like the surrounding code.** Match the naming, comment density and idioms of the file you are in.
- **Comments say why, not what.** Every package/module and exported identifier gets a short doc comment; inside functions, comment only non-obvious decisions (`// The vector type exists only after the first migration, …`).
- **Configuration** comes from `KB_*` environment variables through the platform config helpers (`platform/go/config`, `kb_platform.config`), never from ad-hoc `os.Getenv` / `os.environ`. Defaults work for `task up`.
- **Logging** is structured: a message that names the event plus key/value fields (`"apply event", "subject", …`). No secrets, tokens or document content in logs. Use `error` only for failures someone has to act on.
- **Errors at the API boundary** are gRPC statuses. Map client mistakes to `INVALID_ARGUMENT` / `NOT_FOUND` / `FAILED_PRECONDITION`, a missing peer module to `UNAVAILABLE`, and everything else to `INTERNAL` with a generic message; log the cause server-side.
- **Generated code** (`modules/*/api/**`, sqlc `store/`, `*.gen.ts`, …) is never edited or linted; change the source and run `task gen`.
- **Tests** live next to the code they test and use fakes for other modules' clients and for storage, not live services.

## Go

| Topic | Convention |
|---|---|
| Layout | `service/cmd/<name>/main.go` wires dependencies; logic lives in `service/internal/<pkg>`. |
| Naming | Standard Go: short package names, no stutter (`server.New`, not `server.NewServer`), `ID`/`URL` initialisms. |
| Errors | Return errors, wrap with context using `fmt.Errorf("migrate %s: %w", module, err)`; compare with `errors.Is` / `errors.As` (`errorlint`). Handlers convert to `status.Error` once, at the edge (see `Server.internal` in `modules/document/service/internal/server`). |
| Context | Every blocking call takes a `ctx`; use `net.ListenConfig`, `http.NewRequestWithContext` (`noctx`). |
| Logging | `log/slog` with key/value pairs only and the `…Context` variants when a `ctx` is in scope (`sloglint`). Get the logger from `platform/go/logging`. |
| Interfaces | Declared by the consumer, as small as the consumer needs (`Repository`, `Publisher` in `internal/server`). |
| Tests | Table-driven where there are several cases; fakes embed the interface and implement only what the test uses. `t.Setenv` for config. |
| Lint | `golangci-lint` (pinned in `tools/go.mod`, config `.golangci.yml`): standard linters plus `bodyclose`, `errorlint`, `gocritic`, `misspell`, `noctx`, `nolintlint`, `sloglint`, `unconvert`, `unparam`, `usestdlibvars`; `gofmt` + `goimports` with `github.com/christoph/kb` as local prefix. `//nolint` needs a specific linter and a reason. |

## Python

| Topic | Convention |
|---|---|
| Layout | `src/kb_<component>/` with `__main__.py` (wiring), `config.py` (pydantic settings on top of `kb_platform.config`), `server.py` (servicer). |
| Naming | PEP 8. gRPC servicer methods keep the generated CamelCase names (the only `N802` exception, configured per file). Private helpers start with `_`. |
| Types | Annotate every public function and attribute. `pyright` runs in `standard` mode plus strict checks for our own code (unused imports/variables, private usage, unnecessary casts and `# type: ignore`, missing type arguments). |
| Async | Services and the worker are `asyncio`; never block the loop (`ASYNC` rules). Use `grpc.aio` stubs from the generated packages. |
| Errors | Raise specific exceptions internally; servicers end the call with `await context.abort(grpc.StatusCode.…, "message")`. |
| Logging | `log = logging.getLogger("kb_<component>")` at module level, `%`-style arguments (`log.info("processed document %s", doc_id)`, enforced by `G`). No `print` (`T20`). |
| Tests | `pytest` with `asyncio_mode = "auto"`; plain functions, fixtures over setup classes, `pytest.raises(…, match=…)` (`PT`). Run per component (`--rootdir <component>`). |
| Lint | `ruff` (config in `pyproject.toml`): `E F I UP B SIM ASYNC RUF N C4 PT RET PIE LOG G T20 PERF`, line length 100, `ruff format`. |

## TypeScript

| Topic | Convention |
|---|---|
| Layout | One package per module UI (`modules/<id>/ui`) exporting a `KbModule`; shared components in `@kb/ui` (`platform/ui/kit`), runtime and data hooks in `@kb/module-sdk`. |
| Naming | Components and their files in `PascalCase.tsx`, other modules `camelCase.ts`; hooks start with `use`. |
| Types | `strict` TypeScript (`tsconfig.base.json`); no `any` (`noExplicitAny`), no non-null assertions (`!`), `import type` for type-only imports. |
| Data | Server state through `useClient` + `useQuery` / `useMutation` from `@kb/module-sdk`; no hand-rolled fetch. |
| Effects | Dependency arrays are exhaustive; an intentional exception gets a `biome-ignore` comment with the reason. |
| Logging | No `console.log` (`console.warn` / `console.error` allowed). |
| Tests | Vitest (`*.test.ts(x)` next to the code, root `vitest.config.ts`) with Testing Library for components. |
| Lint | `biome` (`biome.json`): recommended rules plus the above; formatting with 2-space indent, line width 100. Accessibility, tokens and UI patterns: see the [UX standards](ux-standards.md). |

## Quality gates

| Gate | Command | Where |
|---|---|---|
| Generated code is committed | `task check-gen` | CI, pre-push |
| No breaking proto changes | `buf breaking` | CI (PRs) |
| Lint and type checks | `task lint` (buf, `go vet`, golangci-lint, ruff, pyright, biome incl. all `a11y` rules, `tsc`) | CI, pre-push |
| Accessibility: axe tests of kit components, token contrast | `task test` (Vitest) | CI, pre-push |
| Unit tests | `task test:fast` | pre-push |
| Unit tests + coverage minimums | `task test` | CI |

Every linter is pinned (`tools/go.mod`, `uv.lock`, `pnpm-lock.yaml`) and mandatory: `task lint` fails if one can't run.

### Coverage

`task test` fails when a component drops below its minimum:

- Go: per component in `Taskfile.yml` (`test:go` → `MINIMUMS`), statement coverage, generated sqlc code excluded.
- Python: per component in `Taskfile.yml` (`test:py` → `MINIMUMS`), line coverage of `src/` via `pytest-cov`. A new component needs an entry.
- TypeScript: `thresholds` in `vitest.config.ts`.

The minimums start at the current level (rounded down) and only go up: raise one when a PR improves coverage, and explain in the PR if one has to go down.

### Pre-push hook

`task setup` installs a [lefthook](https://lefthook.dev) pre-push hook (`lefthook.yml`) that runs `check-gen`, `lint` and `test:fast`. Commit or stash local changes first, because `check-gen` diffs the working tree. Skip it once with `LEFTHOOK=0 git push`; CI still runs everything.
