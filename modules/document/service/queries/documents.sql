-- name: CreateDocument :one
INSERT INTO document.documents (id, title, filename, content_type, size_bytes, object_key, status, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetDocument :one
SELECT * FROM document.documents WHERE id = $1;

-- name: ListDocuments :many
SELECT * FROM document.documents
ORDER BY created_at DESC, id DESC
LIMIT $1 OFFSET $2;

-- name: UpdateDocument :one
UPDATE document.documents
SET title      = coalesce(sqlc.narg('title'), title),
    metadata   = coalesce(sqlc.narg('metadata'), metadata),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetDocumentStatus :one
UPDATE document.documents
SET status = $2, status_detail = $3, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkDocumentUploaded :one
UPDATE document.documents
SET status = $2, status_detail = $3, size_bytes = $4, content_type = $5, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: SetChunkCount :exec
UPDATE document.documents
SET chunk_count = $2, status = $3, status_detail = '', updated_at = now()
WHERE id = $1;

-- name: DeleteDocument :one
DELETE FROM document.documents WHERE id = $1 RETURNING object_key;
