-- Queries taking an owner_id act for that user and find only their documents.
-- The others serve the internal RPCs of the ingestion pipeline, which acts on
-- any document.

-- name: CreateDocument :one
INSERT INTO document.documents (id, owner_id, title, filename, content_type, size_bytes, object_key, status, metadata, sha256)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetDocument :one
SELECT * FROM document.documents WHERE id = $1 AND owner_id = $2;

-- name: GetAnyDocument :one
SELECT * FROM document.documents WHERE id = $1;

-- name: ListDocuments :many
SELECT * FROM document.documents
WHERE owner_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2 OFFSET $3;

-- name: UpdateDocument :one
UPDATE document.documents
SET title      = coalesce(sqlc.narg('title'), title),
    metadata   = coalesce(sqlc.narg('metadata'), metadata),
    updated_at = now()
WHERE id = $1 AND owner_id = $2
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
DELETE FROM document.documents WHERE id = $1 AND owner_id = $2 RETURNING object_key;

-- The cleanup sweeper's queries; they act on any document.

-- DeleteStaleUploads removes up to max_results documents still waiting for
-- their upload (PENDING_UPLOAD) that were created before cutoff. The status is
-- checked again on the locked row, so an upload marked done meanwhile stays.
-- name: DeleteStaleUploads :many
DELETE FROM document.documents d
WHERE d.status = sqlc.arg(status) AND d.id IN (
    SELECT s.id FROM document.documents s
    WHERE s.status = sqlc.arg(status) AND s.created_at < sqlc.arg(cutoff)
    ORDER BY s.created_at
    LIMIT sqlc.arg(max_results)
)
RETURNING d.object_key;

-- ExistingObjectKeys returns those of keys that belong to a document.
-- name: ExistingObjectKeys :many
SELECT object_key FROM document.documents WHERE object_key = ANY(sqlc.arg(keys)::text[]);
