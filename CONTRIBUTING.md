# Contributing

## Issues

Work is tracked in GitHub issues, structured as **epics → sub-issues**:

- **Epic** (`type:epic`): one per module or area. It states the goal and definition of done. Its work items are GitHub sub-issues.
- **Work item** (`type:feature`, `type:chore`, `type:docs`, `type:bug`): roughly one PR, with acceptance criteria. Every work item is a sub-issue of exactly one epic (bugs may stand alone).

Use the issue forms (Epic / Feature / Chore / Bug); blank issues are disabled.

### Labels

| Group | Labels | Meaning |
|---|---|---|
| type | `type:epic` `type:feature` `type:chore` `type:docs` `type:bug` | Kind of work |
| scope | `module:document` `module:ingestion` `module:chat` `module:llm` `area:platform` `area:ui-shell` `area:infra` | Where it lives (one per issue) |
| lang | `lang:go` `lang:python` `lang:ts` | Stacks touched |
| contract | `api-change` | Changes a `.proto`: run `task gen`, mind `buf breaking` |

### Milestones

- **M1 – MVP**: reliable end to end for a single user: robust ingestion, good RAG chat, usable UI, tests in CI.
- **M2 – Production-ready**: auth and ownership, observability, hardening, data lifecycle.
- **M3 – Extended**: more formats and providers, connectors, advanced search, polish.

## Pull requests

- Branch from `main` and reference the issue (`Closes #123`).
- Run `task gen`, `task lint` and `task test` before pushing; CI checks that generated code is committed.
