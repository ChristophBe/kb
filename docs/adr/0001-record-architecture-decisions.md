# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-10-28

## Context

The key decisions behind kb lived implicitly in `README.md` and `CLAUDE.md`. Contributors (human or agent) could see *what* the conventions are but not *why*, or which alternatives were rejected, so they had no basis for judging when a deviation is fine.

## Decision

We will record architecturally significant decisions as ADRs in `docs/adr/`, using the MADR-style [template](template.md) (context, decision, consequences, status). ADRs 0002–0007 backfill the decisions the codebase was built on.

## Consequences

- New modules, new infrastructure, new cross-module contracts and deviations from the module architecture need an ADR in the same PR (see CONTRIBUTING.md); the PR template asks for it.
- Accepted ADRs are not edited; a decision changes by superseding it.
