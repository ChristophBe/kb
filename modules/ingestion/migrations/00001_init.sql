-- +goose Up
CREATE SCHEMA IF NOT EXISTS ingestion;

-- status holds kb.ingestion.v1.JobStatus values.
CREATE TABLE ingestion.jobs (
    id           uuid PRIMARY KEY,
    document_id  uuid        NOT NULL,
    filename     text        NOT NULL,
    content_type text        NOT NULL,
    status       smallint    NOT NULL,
    error        text        NOT NULL DEFAULT '',
    chunk_count  integer     NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_created_at_idx ON ingestion.jobs (created_at DESC, id DESC);

-- +goose Down
DROP SCHEMA ingestion CASCADE;
