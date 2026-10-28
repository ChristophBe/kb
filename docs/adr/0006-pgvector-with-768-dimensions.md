# 0006. pgvector with 768-dimension embeddings

- Status: Accepted
- Date: 2026-10-28

## Context

Retrieval needs a vector index next to the document metadata. A dedicated vector database would add another server to run and keep consistent with Postgres. Vector columns in pgvector have a fixed dimension, which must match the embedding model.

## Decision

We will store chunks and their embeddings in the `document` module's Postgres schema using pgvector (`embedding vector(768)` in `modules/document/migrations`). The default embedding model is `nomic-embed-text` (768 dimensions); `KB_EMBEDDING_DIMENSIONS` on the `llm` service must match the column.

## Consequences

- One database for metadata and vectors; deleting a document cascades to its chunks.
- Changing the embedding model to one with a different dimension requires a new migration and re-embedding all chunks; the migration and `KB_EMBEDDING_DIMENSIONS` change together.
- Postgres runs the `pgvector/pgvector` image.
