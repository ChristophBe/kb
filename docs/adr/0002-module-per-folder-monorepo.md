# 0002. Organise the monorepo by module

- Status: Accepted
- Date: 2026-10-28

## Context

kb combines Go services, Python services and workers, and a React UI. A layout by language (`go/`, `python/`, `web/`) would scatter one feature across three trees and make module ownership and removal hard. We want modules that can be added, disabled or replaced independently.

## Decision

We will keep one monorepo organised **by module**: everything a module owns lives in `modules/<id>/` — its manifest (`module.yaml`), proto contract, generated API bindings, backend (`service/`, `worker/`), migrations, UI package and compose fragment. Module-agnostic shared code lives in `platform/`, which never imports a module. `tools/modgen` derives the wiring (compose includes, Envoy routes, buf templates, UI registry, issue-form scopes) from the manifests.

## Consequences

- A module is added by creating its folder and running `task gen`; nothing central is hand-edited.
- Modules talk only through another module's generated client or its events; reading another module's schema, bucket or stream is forbidden (enforcement: #68).
- Each language keeps its own toolchain inside a shared workspace (Go workspace module, uv workspace, pnpm workspace), so tooling must cope with mixed-language folders.
