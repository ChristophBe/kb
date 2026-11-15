-- +goose Up
-- team_ids are the teams the document was shared with at upload, as sent in
-- CreateUploadRequest; reprocessing publishes them again. The document module
-- owns the current sharing.
ALTER TABLE ingestion.jobs ADD COLUMN team_ids uuid[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE ingestion.jobs DROP COLUMN team_ids;
