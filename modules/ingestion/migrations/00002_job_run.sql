-- +goose Up
-- run counts a job's processing runs: 1 for the upload, incremented every
-- time the job is reprocessed. Events carry it, so a late event of an earlier
-- run cannot change the current one.
ALTER TABLE ingestion.jobs ADD COLUMN run integer NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE ingestion.jobs DROP COLUMN run;
