-- +goose Up
-- owner_id is the subject of the user who created the upload (the x-kb-user
-- Envoy forwards from the verified token); users only see their own jobs.
-- Jobs from before ownership go to the dev Dex user alice (deploy/dex), so
-- local data stays visible when signing in as her.
ALTER TABLE ingestion.jobs ADD COLUMN owner_id text NOT NULL DEFAULT 'CgVhbGljZRIFbG9jYWw';
ALTER TABLE ingestion.jobs ALTER COLUMN owner_id DROP DEFAULT;

-- Listing is per owner now, so the index leads with it.
DROP INDEX ingestion.jobs_created_at_idx;
CREATE INDEX jobs_owner_created_at_idx ON ingestion.jobs (owner_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX ingestion.jobs_owner_created_at_idx;
CREATE INDEX jobs_created_at_idx ON ingestion.jobs (created_at DESC, id DESC);
ALTER TABLE ingestion.jobs DROP COLUMN owner_id;
