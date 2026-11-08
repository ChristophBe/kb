# kb — modular knowledge management

A modular knowledge-management system: ingest documents, manage them, and chat with them.

**Website:** [christophbe.github.io/kb](https://christophbe.github.io/kb/), built from [`apps/site`](apps/site) and published to GitHub Pages on every push to `main`.

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

No GPU or want a fast smoke test? Use `KB_LLM_PROVIDER=fake KB_RAG_MIN_SCORE=-1 task up` (deterministic echo answers and hash embeddings, which need the relevance threshold off). To use an Ollama running on the host (faster on macOS), set `KB_OLLAMA_URL=http://host.docker.internal:11434`. To chat with Claude, set `KB_CHAT_PROVIDER=anthropic`, `KB_EMBEDDING_PROVIDER=ollama` and `KB_ANTHROPIC_API_KEY`: Anthropic has no embedding models, so search and document processing keep using Ollama. `KB_CHAT_PROVIDER` and `KB_EMBEDDING_PROVIDER` each fall back to `KB_LLM_PROVIDER`. See `.env.example` for all settings, including the host ports if 8080/3000 are taken.

To run a released version from the published images instead of building, see [Container images](docs/operations/images.md) (`KB_VERSION=<version> docker compose -f compose.yaml -f deploy/release.compose.yaml up`).

## Authentication

Every call through the gateway needs an OIDC access token: Envoy verifies it (`jwt_authn`, keys from the issuer's JWKS) and answers `UNAUTHENTICATED` otherwise. Only CORS preflights and health checks pass without one. Envoy forwards the token's subject to the services as the `x-kb-user` header and drops any `x-kb-user` the client sent; services read it with `grpcserver.UserFromContext(ctx)` (Go) or `kb_platform.grpc.current_user()` (Python). Calls between services carry no user yet.

`task up` starts [Dex](https://dexidp.io) as the dev identity provider at `http://localhost:5556/dex`, configured in `deploy/dex/config.yaml.tpl`; nothing needs setting up by hand. It has two users, `alice@example.com` and `bob@example.com`, both with the password `password`, and two public clients: `kb-web` for the web shell (authorization code with PKCE) and `kb-cli` for scripts and tests. Fetch a token without a browser with the password grant:

```sh
TOKEN=$(curl -s http://localhost:5556/dex/token -d grant_type=password -d client_id=kb-cli \
  -d username=alice@example.com -d password=password -d scope=openid | jq -r .access_token)
```

and send it as `authorization: Bearer $TOKEN` with each call to `:8080` (see `tests/e2e`).

The web shell signs in with `kb-web` (authorization code with PKCE, via [oidc-client-ts](https://github.com/authts/oidc-client-ts)): a signed-out visitor is sent to Dex and comes back to the route they asked for, and every call carries `authorization: Bearer <access token>`. With `offline_access` Dex issues a refresh token, which renews the access token in the background; a call rejected as `UNAUTHENTICATED` sends the browser back to sign-in. The session is kept in `localStorage`; **Sign out** in the sidebar removes it (Dex has no logout endpoint, and keeps no login session, so the next sign-in asks for the password again). The shell reads the issuer and client id from its runtime `config.json`, written from `KB_OIDC_ISSUER` and `KB_OIDC_CLIENT_ID` when the web container starts. Dex accepts `http://localhost:$KB_WEB_PORT/auth/callback` and, for `task web`, `http://localhost:$KB_WEB_DEV_PORT/auth/callback` (Vite's port, 5173 by default) as redirect URIs.

To use another identity provider, set `KB_OIDC_ISSUER` (the `iss` of its tokens), `KB_OIDC_JWKS_URL` (where Envoy fetches the signing keys, http or https) and `KB_OIDC_AUDIENCES` (accepted client ids, comma-separated). With Dex on another host port, set `KB_DEX_PORT` and `KB_OIDC_ISSUER` together. Another provider needs a public client for the web shell (PKCE, redirect URI `<web origin>/auth/callback`), named in `KB_OIDC_CLIENT_ID`.

## Development

| Command | |
|---|---|
| `task gen` | Regenerate everything (module wiring, protobuf, sqlc) |
| `task lint` / `task test` | All languages |
| `task dev` | Stack with hot reload (`docker compose watch`) |
| `task web` | Vite dev server for the UI against the running stack |
| `task site` | Vite dev server for the marketing site (`apps/site`) |
| `task ci` | What CI runs (incl. a check that generated code is committed) |

### Adding a module

Follow the [module architecture](docs/architecture/module.md) and copy the structure of the reference implementation for your language (`document` for Go, `llm` for Python). A new module needs an ADR (see CONTRIBUTING.md).

1. Create `modules/<id>/module.yaml` (declare the modules it uses in `depends_on` and the event subjects it subscribes to in `consumes`) and `modules/<id>/proto/kb/<id>/v1/<id>.proto`.
2. Add the backend under `modules/<id>/service` (and `compose.yaml`). For Python, also add it to the workspace members in `pyproject.toml`.
3. Optionally add `modules/<id>/ui` exporting a `KbModule` (see `platform/ui/module-sdk`), and add it as a dependency of `apps/web`.
4. `task gen`. This generates the API packages, Envoy routes, compose includes and the UI registry.
