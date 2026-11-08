-- name: CreateJob :one
INSERT INTO ingestion.jobs (id, document_id, filename, content_type, status)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetJob :one
SELECT * FROM ingestion.jobs WHERE id = $1;

-- name: ListJobs :many
SELECT * FROM ingestion.jobs
ORDER BY created_at DESC, id DESC
LIMIT $1 OFFSET $2;

-- AdvanceJob moves a job forward within its current run. Status values are
-- ordered, so a stale or duplicate event can never move a job backwards,
-- terminal jobs (DONE=4, FAILED=5) never change, and events of an earlier run
-- are ignored. The only way back is ReprocessJob. A DONE job is 100% done.
-- name: AdvanceJob :one
UPDATE ingestion.jobs
SET status = sqlc.arg(status), error = sqlc.arg(error), chunk_count = sqlc.arg(chunk_count),
    progress = CASE WHEN sqlc.arg(status) = 4 THEN 100 ELSE progress END,
    updated_at = now()
WHERE id = sqlc.arg(id) AND run = sqlc.arg(run) AND status < 4 AND status < sqlc.arg(status)
RETURNING *;

-- ReportProgress records the stage and progress of a job's current run. A
-- report means the worker is at it, so a QUEUED job (whose started event is
-- late) becomes PROCESSING (3). Stage and progress only grow, so stale and
-- duplicate reports change nothing, and terminal jobs are left alone.
-- name: ReportProgress :one
UPDATE ingestion.jobs
SET status = 3, stage = sqlc.arg(stage), progress = sqlc.arg(progress), updated_at = now()
WHERE id = sqlc.arg(id) AND run = sqlc.arg(run) AND status IN (2, 3)
  AND (stage, progress) < (sqlc.arg(stage)::smallint, sqlc.arg(progress)::smallint)
RETURNING *;

-- ReprocessJob is the one transition back: it queues a terminal job
-- (DONE=4, FAILED=5) again (QUEUED=2) as a new run, clearing the result of
-- the previous one.
-- name: ReprocessJob :one
UPDATE ingestion.jobs
SET status = 2, error = '', chunk_count = 0, progress = 0, stage = 0, run = run + 1, updated_at = now()
WHERE id = sqlc.arg(id) AND status IN (4, 5)
RETURNING *;
