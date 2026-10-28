# 0005. Only the `llm` module talks to LLM vendors

- Status: Accepted
- Date: 2026-10-28

## Context

Several modules need generation or embeddings (chat answers, ingestion embeddings). If each called vendor APIs directly, credentials, model choice, retries and the embedding dimension would be configured in several places, and switching vendors would touch every module.

## Decision

We will route every LLM call through the `llm` module (`kb.llm.v1.LlmService`: `Generate`, `Embed`, `ListModels`, `GetProviderStatus`). Providers are implemented in `modules/llm/service/src/kb_llm/providers/` and registered in `REGISTRY`; Ollama is the default and `fake` gives deterministic answers and embeddings for tests and smoke runs.

## Consequences

- Vendor SDKs and credentials exist in exactly one service.
- A new provider is one class plus a registry entry; callers don't change.
- The `llm` service is on the critical path of chat and ingestion; callers must handle it being unavailable.
