-- +goose Up
-- Every chunk records the embedding model that made its vector, so a search
-- only compares vectors of the model that embedded the query (vectors of
-- different models are not comparable), and a reindex (ReindexDocuments) can
-- tell which documents are outdated. embedding_dimensions is the vector's own
-- length.
--
-- Chunks that exist before this migration were embedded by the llm service's
-- default model, nomic-embed-text, unless the deployment set
-- KNOWCEL_EMBEDDING_MODEL to another one; they are marked with the default. A
-- deployment that used another model reindexes with force (see
-- docs/operations/embedding-model.md).
ALTER TABLE document.chunks
    ADD COLUMN embedding_model text NOT NULL DEFAULT 'nomic-embed-text',
    ADD COLUMN embedding_dimensions integer GENERATED ALWAYS AS (vector_dims(embedding)) STORED;
-- Rows written from now on name their model.
ALTER TABLE document.chunks ALTER COLUMN embedding_model DROP DEFAULT;

-- The reindex looks for a document's chunks of other models.
CREATE INDEX chunks_embedding_model_idx ON document.chunks (embedding_model, document_id);

-- +goose Down
DROP INDEX document.chunks_embedding_model_idx;
ALTER TABLE document.chunks
    DROP COLUMN embedding_dimensions,
    DROP COLUMN embedding_model;
