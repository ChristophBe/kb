# 0008. Reference module architecture

- Status: Accepted
- Date: 2026-10-29

## Context

Modules share a manifest and folder layout ([ADR 0002](0002-module-per-folder-monorepo.md)), but the inside of a service was convention by example. Go and Python services differed in where application logic lives, where ports are declared, how peer errors reach callers and how hard a module depends on its peers at runtime (compose waits for peer services to be healthy). M1 adds features to every module, which would multiply these differences.

Options considered:

1. **Leave it to each module.** No upfront cost, but every reviewer has to judge structure from scratch, and cross-module rules (soft dependencies, status mapping) stay unenforceable.
2. **Full hexagonal layout everywhere** (separate transport, application, ports and adapter packages from day one). Uniform, but heavy for modules whose handlers are a validation plus one database call.
3. **One layered architecture with a rule for when layers split.** Fixed layers and allowed dependencies; transport and application may share a package until a use case orchestrates several adapters or is shared by two transports.

## Decision

We will follow option 3, described in [docs/architecture/module.md](../architecture/module.md):

- Layers contract → transport → application → adapters, plus wiring, with the allowed dependencies listed there and equivalent layouts for Go (`service/internal/...`) and Python (`src/kb_<component>/...`).
- Configuration through `KB_*` variables and the platform helpers, platform logging, standard gRPC health reflecting only the module's own infrastructure, and one gRPC status mapping applied in transport.
- Other modules are reached only through their generated clients or events, and they are **soft dependencies**: a module starts without them and answers `UNAVAILABLE` for calls that need them.
- `module.yaml` declares the modules (`depends_on`) and event subjects (`consumes`) a module uses; tooling validates and enforces them (#68).
- `document` (Go) and `llm` (Python) are the reference implementations.

## Consequences

- New modules copy a reference implementation; reviews check against one document.
- Existing gaps are tracked as issues (#90, #91, #92, plus existing #33, #46, #51, #68) and fixed before the M1 features that touch the same code.
- One module failing no longer blocks others from starting, at the cost of every caller handling `UNAVAILABLE`.
- Deviating from the architecture needs a new ADR (CONTRIBUTING.md).
