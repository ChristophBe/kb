<h1 align="center">
  <img src="apps/site/public/favicon.svg" alt="" width="48" height="48"><br>
  Knowcelium: the knowledge backbone of your organization
</h1>

Under every forest runs a mycelium that links tree to tree, carries what each one needs, and turns what has fallen into new growth. Knowcelium does the same for an organization's knowledge, through modules. Formerly kb.

> **Renaming in progress:** the product is Knowcelium. Environment variables, the compose project and the image names are renamed; the repository URL and the Helm chart keep the `kb` name until the remaining rename issues land.
>
> **Upgrading:** settings are now `KNOWCEL_*` instead of `KB_*`. `KB_*` is still accepted for one release, with a deprecation warning (`task up`/`task dev` map the ones in your `.env`); rename them. Images are published as `ghcr.io/christophbe/knowcelium-<component>`.

An open-source, modular knowledge backbone: ingest documents, manage them, and chat with them.

Name, story and voice: [Brand](docs/brand.md).

**Website:** [christophbe.github.io/knowcelium](https://christophbe.github.io/knowcelium/), built from [`apps/site`](apps/site) and published to GitHub Pages on every push to `main`.

- **Go** — core infrastructure services (document, ingestion, iam)
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
| `llm` | Python service :9004 | Single gateway to LLM providers (Ollama by default, Anthropic, OpenAI-compatible servers, `fake` for tests) |
| `iam` | Go service :9006 | Registry of users (registered on first sign-in) and platform admins; teams and roles follow |
| `curation` | Python service :9005 | Relevance and freshness scores of documents; findings for duplicate, superseded and conflicting ones |

```
browser ──gRPC-Web──▶ envoy :8080 ──gRPC──▶ document / ingestion / chat / llm / iam / curation
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

No GPU or want a fast smoke test? Use `KNOWCEL_LLM_PROVIDER=fake KNOWCEL_RAG_MIN_SCORE=-1 task up` (deterministic echo answers and hash embeddings, which need the relevance threshold off). To use an Ollama running on the host (faster on macOS), set `KNOWCEL_OLLAMA_URL=http://host.docker.internal:11434`. To chat with Claude, set `KNOWCEL_CHAT_PROVIDER=anthropic`, `KNOWCEL_EMBEDDING_PROVIDER=ollama` and `KNOWCEL_ANTHROPIC_API_KEY`: Anthropic has no embedding models, so search and document processing keep using Ollama. To use OpenAI or a local OpenAI-compatible server (LM Studio, vLLM), set `KNOWCEL_LLM_PROVIDER=openai` with `KNOWCEL_OPENAI_URL` and, where the server checks one, `KNOWCEL_OPENAI_API_KEY`; it serves chat and embeddings. `KNOWCEL_CHAT_PROVIDER` and `KNOWCEL_EMBEDDING_PROVIDER` each fall back to `KNOWCEL_LLM_PROVIDER`. See `.env.example` for the common ones, including the host ports if 8080/3000 are taken, and [docs/configuration.md](docs/configuration.md) for every variable with its default. Services check their settings at startup and exit with one message listing every problem.

To run a released version from the published images instead of building, see [Container images](docs/operations/images.md) (`KNOWCEL_VERSION=<version> docker compose -f compose.yaml -f deploy/release.compose.yaml up`). To deploy to Kubernetes, use the Helm chart in `deploy/helm/kb` ([Kubernetes](docs/operations/kubernetes.md)). To brand the UI as your organization, see [Branding](docs/operations/branding.md). To back up and restore the data or roll back migrations, see [Backup, restore and migrations](docs/operations/backup-restore.md).

To follow a request across the services, start the stack with tracing and Jaeger: `KNOWCEL_OTEL_ENDPOINT=http://otel-collector:4317 task up -- --profile observability`, then open http://localhost:16686. The same profile runs Prometheus (http://localhost:9090), which scrapes the `/metrics` every component serves ([Metrics](docs/metrics.md)). See [Observability](docs/operations/observability.md).

## Authentication

Every call through the gateway needs an OIDC access token: Envoy verifies it (`jwt_authn`, keys from the issuer's JWKS) and answers `UNAUTHENTICATED` otherwise. Only CORS preflights and health checks pass without one. Envoy forwards the token's subject to the services as the `x-kb-user` header and drops any `x-kb-user` the client sent; services read it with `grpcserver.UserFromContext(ctx)` (Go) or `knowcel_platform.grpc.current_user()` (Python). Calls between services carry no user yet.

`task up` starts [Dex](https://dexidp.io) as the dev identity provider at `http://localhost:5556/dex`, configured in `deploy/dex/config.yaml.tpl`; nothing needs setting up by hand. It has two users, `alice@example.com` and `bob@example.com`, both with the password `password`, and two public clients: `kb-web` for the web shell (authorization code with PKCE) and `kb-cli` for scripts and tests. Fetch a token without a browser with the password grant:

```sh
TOKEN=$(curl -s http://localhost:5556/dex/token -d grant_type=password -d client_id=kb-cli \
  -d username=alice@example.com -d password=password -d scope=openid | jq -r .access_token)
```

and send it as `authorization: Bearer $TOKEN` with each call to `:8080` (see `tests/e2e`).

The web shell signs in with `kb-web` (authorization code with PKCE, via [oidc-client-ts](https://github.com/authts/oidc-client-ts)): a signed-out visitor is sent to Dex and comes back to the route they asked for, and every call carries `authorization: Bearer <access token>`. With `offline_access` Dex issues a refresh token, which renews the access token in the background; a call rejected as `UNAUTHENTICATED` sends the browser back to sign-in. The session is kept in `localStorage`; **Sign out** in the sidebar removes it (Dex has no logout endpoint, and keeps no login session, so the next sign-in asks for the password again). The shell reads the issuer and client id from its runtime `config.json`, written from `KNOWCEL_OIDC_ISSUER` and `KNOWCEL_OIDC_CLIENT_ID` when the web container starts. Dex accepts `http://localhost:$KNOWCEL_WEB_PORT/auth/callback` and, for `task web`, `http://localhost:$KNOWCEL_WEB_DEV_PORT/auth/callback` (Vite's port, 5173 by default) as redirect URIs.

To use another identity provider, set `KNOWCEL_OIDC_ISSUER` (the `iss` of its tokens), `KNOWCEL_OIDC_JWKS_URL` (where Envoy fetches the signing keys, http or https) and `KNOWCEL_OIDC_AUDIENCES` (accepted client ids, comma-separated). With Dex on another host port, set `KNOWCEL_DEX_PORT` and `KNOWCEL_OIDC_ISSUER` together. Another provider needs a public client for the web shell (PKCE, redirect URI `<web origin>/auth/callback`), named in `KNOWCEL_OIDC_CLIENT_ID`.

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

1. Create `modules/<id>/module.yaml` (declare the modules it uses in `depends_on` and the event subjects it subscribes to in `consumes`) and `modules/<id>/proto/knowcel/<id>/v1/<id>.proto`.
2. Add the backend under `modules/<id>/service` (and `compose.yaml`). For Python, also add it to the workspace members in `pyproject.toml`.
3. Optionally add `modules/<id>/ui` exporting a `KbModule` (see `platform/ui/module-sdk`), and add it as a dependency of `apps/web`.
4. `task gen`. This generates the API packages, Envoy routes, compose includes and the UI registry.
