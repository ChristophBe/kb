-- +goose Up
-- ReplaceUpload looks up the job of a document.
CREATE INDEX jobs_document_id_idx ON ingestion.jobs (document_id);

-- +goose Down
DROP INDEX ingestion.jobs_document_id_idx;
