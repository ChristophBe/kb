-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS document;

CREATE TABLE document.documents (
    id            uuid PRIMARY KEY,
    title         text        NOT NULL,
    filename      text        NOT NULL,
    content_type  text        NOT NULL,
    size_bytes    bigint      NOT NULL DEFAULT 0,
    object_key    text        NOT NULL,
    status        smallint    NOT NULL,
    status_detail text        NOT NULL DEFAULT '',
    chunk_count   integer     NOT NULL DEFAULT 0,
    metadata      jsonb       NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_created_at_idx ON document.documents (created_at DESC, id DESC);

-- The vector dimension must match KB_EMBEDDING_DIMENSIONS of the llm module.
CREATE TABLE document.chunks (
    document_id uuid    NOT NULL REFERENCES document.documents (id) ON DELETE CASCADE,
    idx         integer NOT NULL,
    text        text    NOT NULL,
    metadata    jsonb   NOT NULL DEFAULT '{}',
    embedding   vector(768) NOT NULL,
    PRIMARY KEY (document_id, idx)
);
CREATE INDEX chunks_embedding_idx ON document.chunks USING hnsw (embedding vector_cosine_ops);

-- +goose Down
DROP SCHEMA document CASCADE;
