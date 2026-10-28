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

-- AdvanceJob moves a job forward. Status values are ordered, so a stale or
-- duplicate event can never move a job backwards, and terminal jobs
-- (DONE=4, FAILED=5) never change.
-- name: AdvanceJob :one
UPDATE ingestion.jobs
SET status = sqlc.arg(status), error = sqlc.arg(error), chunk_count = sqlc.arg(chunk_count), updated_at = now()
WHERE id = sqlc.arg(id) AND status < 4 AND status < sqlc.arg(status)
RETURNING *;
