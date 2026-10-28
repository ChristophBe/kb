# 0007. Commit generated code

- Status: Accepted
- Date: 2026-10-28

## Context

kb relies on static code generation: buf for protobuf bindings, sqlc for database access, and `modgen` for wiring. If generated code were built on demand, every consumer (IDEs, Docker builds, other modules) would need the full toolchain, and reviewers couldn't see how a contract change affects the bindings.

## Decision

We will commit all generated output (`modules/*/api/**`, `platform/api/**`, sqlc `internal/store`, `compose.yaml`, `deploy/envoy/envoy.yaml`, `apps/web/src/modules.gen.ts`, buf templates, issue forms). Generated files are never edited by hand; `task gen` regenerates them, and CI (`task check-gen`) fails when the committed output is out of date.

## Consequences

- Builds and IDEs work after a plain checkout; Docker images need no generators.
- Diffs show the effect of a contract change; PRs are larger.
- Every change to a proto, a `module.yaml` or a SQL query must be followed by `task gen` in the same commit.
