# Changing the embedding model

Search and chat compare the vector of a question with the vectors of the stored passages (chunks). Vectors of different models can't be compared, so the chunks of every document have to be made again when `KB_EMBEDDING_MODEL` changes. This page covers what happens meanwhile, how to reindex, and what else to change when the new model's vectors have another dimension. The column and its dimension: [ADR 0006](../adr/0006-pgvector-with-768-dimensions.md).

## How the index keeps track of the model

- Every chunk stores the name of the embedding model that made its vector (`document.chunks.embedding_model`, as the llm service reports it in `EmbedResponse.model`) and the vector's dimension (`embedding_dimensions`). The ingestion worker sends the model with the chunks (`AddChunks`).
- Every search embeds the question with the model the llm service uses now and only compares it with chunks of that model (`SearchDocuments`, `SearchChunks`). Mixed vectors are never compared, so after a change nothing wrong is found: documents that are not reindexed yet are simply missing from search and chat sources until they are.
- Chunks that existed before the model was recorded (migration `00006`) are marked `nomic-embed-text`, the default model. If the deployment ran another model, reindex with `force` (below), which also corrects the mark.

## Change the model and reindex

1. Pull or provide the new model (for Ollama `ollama pull <model>`), and set `KB_EMBEDDING_MODEL` for the llm service. Set `KB_CHUNK_TOKENIZER`, `KB_CHUNK_TOKENS` and `KB_EMBEDDING_MAX_TOKENS` for it too if they differ (`.env.example`). Restart `llm-service`, `ingestion-worker` and `chat-service` (which embeds the user manual in memory at startup, with the model of that moment). With the fake provider, `KB_FAKE_EMBEDDING_MODEL` is the model name.
2. Ask for the reindex: `DocumentService.ReindexDocuments`. It queues every ready document of the calling user whose chunks come from another model, and answers with how many (`requested`) and the model. It doesn't wait for the processing.
3. Follow the processing on the ingestion page (each document's job runs again) or in the `kb_ingestion_worker_jobs` metric. A document is searchable again as soon as its new chunks are stored.

The call is public (there are no roles yet) and acts on the caller's own documents only, so each user reindexes theirs; nobody can spend processing on another user's documents, and an unknown or foreign `document_ids` entry is `NOT_FOUND`. Operators run it for each user, with that user's token:

```sh
TOKEN=$(curl -s -d grant_type=password -d client_id=kb-cli -d username=alice@example.com \
  -d password=password -d 'scope=openid email profile' "$KB_OIDC_ISSUER/token" | jq -r .access_token)
buf curl --protocol grpcweb -H "Authorization: Bearer $TOKEN" -d '{}' \
  --schema modules/document/proto \
  http://localhost:8080/knowcel.document.v1.DocumentService/ReindexDocuments
```

(`go tool -modfile=tools/go.mod buf curl ...` in a checkout without `buf`.) Request fields: `document_ids` limits it to some documents, `force: true` reindexes documents already on the current model too (after changing the chunk sizes, or when the recorded model is wrong).

What the reindex does and doesn't do:

- **Old chunks stay until the new ones are in.** Each document is processed again as a new run of its ingestion job (the same as **Retry** on the ingestion page), and `AddChunks` swaps the chunks in one transaction. A run that fails leaves the old chunks, so nothing is lost, but they belong to the old model and aren't searched (see above): the document is missing from search until a later run succeeds. Retry it from the ingestion page, or call `ReindexDocuments` again.
- **Busy documents wait.** A document whose job is queued or processing is retried every 15 seconds for about 10 minutes. A document waiting for its upload, and one with a new version in progress (`pending_version`), is skipped: that file is embedded with the new model anyway.
- It is idempotent: calling it again queues the documents that are still on another model (or all with `force`), so repeating it after an outage is safe.
- It needs `llm-service` (to learn the current model) and NATS: it answers `UNAVAILABLE` otherwise. Nothing is queued then, or only a first part of the documents.

The request travels as the event `knowcel.document.reindex_requested` on the `DOCUMENT` stream (one message per document, with the owner), which the ingestion service consumes. Ingestion can't be called from the document service (it depends on it), hence the event.

## A model with another dimension

The vector column has a fixed dimension, 768 (`vector(768)` in `modules/document/migrations`), which the llm service checks against `KB_EMBEDDING_DIMENSIONS`: it refuses embeddings of any other size. A model with another dimension, say 1024, needs both changed together, and the chunks of the old model can't be kept:

1. Add a migration to `modules/document/migrations`, for example `00007_embedding_1024.sql`. The stored vectors can't be converted, so it removes the chunks; the documents stay and are reindexed afterwards. pgvector's HNSW index supports up to 2000 dimensions; above that, use `halfvec` or drop the index (searches then scan all chunks).

   ```sql
   -- +goose Up
   DROP INDEX document.chunks_embedding_idx;
   -- A generated column on the vector blocks changing its type.
   ALTER TABLE document.chunks DROP COLUMN embedding_dimensions;
   DELETE FROM document.chunks;
   ALTER TABLE document.chunks ALTER COLUMN embedding TYPE vector(1024);
   ALTER TABLE document.chunks
       ADD COLUMN embedding_dimensions integer GENERATED ALWAYS AS (vector_dims(embedding)) STORED;
   CREATE INDEX chunks_embedding_idx ON document.chunks USING hnsw (embedding vector_cosine_ops);
   UPDATE document.documents SET chunk_count = 0 WHERE chunk_count <> 0;

   -- +goose Down
   -- Vectors of the other dimension can't be converted back; restore a backup.
   SELECT 1/0;
   ```

2. Set `KB_EMBEDDING_DIMENSIONS=1024` next to `KB_EMBEDDING_MODEL` (llm service; `.env.example`, the Helm chart's `components.llm-service.env`) and the chunking settings of the new model.
3. Deploy: the document service migrates on startup. Until the documents are reindexed, search finds nothing.
4. Reindex with `force: true`: the removed chunks leave the documents with no chunk of another model, so they would not count as outdated without it.

Also update the dimension in the places that name it: `CLAUDE.md`, [ADR 0006](../adr/0006-pgvector-with-768-dimensions.md) (a superseding ADR if 768 is no longer the default).

## Not covered

There is no button in the web UI yet, and no reindex for all users at once.
