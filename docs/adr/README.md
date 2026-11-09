# Architecture decision records

Significant decisions are recorded here, one file per decision, using [template.md](template.md) (MADR-style). See [CONTRIBUTING.md](../../CONTRIBUTING.md#architecture-decisions) for when an ADR is required.

- Number files sequentially: `NNNN-short-title.md`. Never renumber.
- An ADR is immutable once `Accepted`. To change a decision, write a new ADR and set the old one to `Superseded by NNNN`.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-module-per-folder-monorepo.md) | Organise the monorepo by module | Accepted |
| [0003](0003-grpc-between-modules-grpc-web-via-envoy.md) | gRPC between modules, gRPC-Web through Envoy | Accepted |
| [0004](0004-nats-jetstream-events-between-modules.md) | NATS JetStream for events between modules | Accepted |
| [0005](0005-llm-module-is-the-only-vendor-gateway.md) | Only the `llm` module talks to LLM vendors | Accepted |
| [0006](0006-pgvector-with-768-dimensions.md) | pgvector with 768-dimension embeddings | Accepted |
| [0007](0007-commit-generated-code.md) | Commit generated code | Accepted |
| [0008](0008-reference-module-architecture.md) | Reference module architecture | Accepted |
| [0009](0009-oidc-authentication-at-the-gateway.md) | Authenticate with OIDC tokens at the gateway | Accepted |
| [0010](0010-opentelemetry-tracing.md) | Trace with OpenTelemetry, off unless configured | Accepted |
