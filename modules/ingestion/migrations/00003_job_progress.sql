-- +goose Up
-- progress (0–100) and stage (kb.ingestion.v1.JobStage) of the job's current
-- run, reported by the worker while it processes the job.
ALTER TABLE ingestion.jobs
    ADD COLUMN progress smallint NOT NULL DEFAULT 0,
    ADD COLUMN stage    smallint NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE ingestion.jobs DROP COLUMN progress, DROP COLUMN stage;
