# 0014. Keep relevance and consistency in a `curation` module

- Status: Accepted
- Date: 2026-11-18

## Context

Retrieval ranks only by vector similarity, so an old or replaced document ranks as high as the current one, and different versions of the same knowledge side by side make answers inconsistent. Scoring documents and finding duplicates, replaced versions and contradictions needs state of its own and calls to `document` (search) and `llm` (contradiction checks). Options considered:

- **Put it into `document`**: no new component, but `document` would grow logic that has nothing to do with storing and searching content, and it would need to call `llm` for judgements.
- **Put it into `chat`**: scores would only exist for retrieval, and findings have nothing to do with conversations.
- **A separate `curation` module**: one place that owns scores and findings; `chat` asks it through its gRPC client and treats it as a soft dependency ([module architecture](../architecture/module.md#talking-to-other-modules)).

## Decision

We will add a `curation` module (`modules/curation`, Python, schema `curation`, `curation-service` on port 9005, metrics 9107) that owns document scores and findings (duplicate, superseded, conflict). It reads documents only through `document` and `llm`'s generated clients, and reacts to `knowcel.ingestion.processed` events.

## Consequences

- `document` and `chat` stay simple; `chat` later ranks with curation scores and falls back to similarity alone while curation is down.
- Curation results only cover documents the caller can see, so every RPC resolves visibility through `document` and `iam` instead of reading their data.
- One more service to run and monitor.
- Revisit if scoring needs to run inside the retrieval query itself, where a round trip per search becomes too slow.
