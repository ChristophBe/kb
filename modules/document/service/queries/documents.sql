-- Queries taking an owner_id act for that user and find only their documents;
-- those that also take team_ids find the documents shared with any of those
-- teams too (the caller's). The others serve the internal RPCs of the ingestion pipeline, which acts on
-- any document.

-- name: CreateDocument :one
INSERT INTO document.documents (id, owner_id, title, filename, content_type, size_bytes, object_key, status, metadata, sha256)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetDocument :one
SELECT * FROM document.documents WHERE id = $1 AND owner_id = $2;

-- name: GetVisibleDocument :one
SELECT d.* FROM document.documents d
WHERE d.id = sqlc.arg(id)
  AND (d.owner_id = sqlc.arg(owner_id)
       OR EXISTS (SELECT 1 FROM document.document_teams t
                  WHERE t.document_id = d.id AND t.team_id = ANY(sqlc.arg(team_ids)::uuid[])));

-- name: GetAnyDocument :one
SELECT * FROM document.documents WHERE id = $1;

-- ListDocuments is keyset-paginated: a page continues after the (created_at, id) of
-- the last row of the previous one (both after_* NULL for the first page), so
-- rows inserted meanwhile never shift it. It lists the user's documents and
-- those shared with their teams: each of the two sets is read in order from
-- its index (the owner's, and the teams') and cut to a page before they are
-- merged, which an OR of both conditions could not do.
-- name: ListDocuments :many
SELECT d.* FROM document.documents d
WHERE d.id IN (
    (SELECT o.id FROM document.documents o
     WHERE o.owner_id = sqlc.arg(owner_id)
       AND (o.created_at, o.id) < (
         coalesce(sqlc.narg(after_created_at)::timestamptz, 'infinity'),
         coalesce(sqlc.narg(after_id)::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT sqlc.arg(max_results))
    UNION
    (SELECT s.id FROM document.documents s
     JOIN document.document_teams t ON t.document_id = s.id
     WHERE t.team_id = ANY(sqlc.arg(team_ids)::uuid[])
       AND (s.created_at, s.id) < (
         coalesce(sqlc.narg(after_created_at)::timestamptz, 'infinity'),
         coalesce(sqlc.narg(after_id)::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT sqlc.arg(max_results))
)
ORDER BY d.created_at DESC, d.id DESC
LIMIT sqlc.arg(max_results);

-- name: ListDocumentTeams :many
SELECT document_id, team_id FROM document.document_teams
WHERE document_id = ANY(sqlc.arg(document_ids)::uuid[]);

-- AddDocumentTeams and RemoveDocumentTeams are idempotent.
-- name: AddDocumentTeams :exec
INSERT INTO document.document_teams (document_id, team_id)
SELECT sqlc.arg(document_id), unnest(sqlc.arg(team_ids)::uuid[])
ON CONFLICT DO NOTHING;

-- name: RemoveDocumentTeams :exec
DELETE FROM document.document_teams
WHERE document_id = sqlc.arg(document_id) AND team_id = ANY(sqlc.arg(team_ids)::uuid[]);

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

-- The pending version's queries: a new file from ReplaceContent that becomes
-- the document's current one once it has been processed.

-- StartPendingVersion records a new file for a READY (4) or FAILED (5)
-- document, replacing a pending version that awaits its upload (1) or failed
-- (5). The document itself is left as it is. No row means the document is
-- not the owner's, or busy.
-- name: StartPendingVersion :one
UPDATE document.documents
SET pending_status = sqlc.arg(pending_status), pending_status_detail = '',
    pending_object_key = sqlc.arg(pending_object_key), pending_filename = sqlc.arg(pending_filename),
    pending_content_type = sqlc.arg(pending_content_type), pending_size_bytes = sqlc.arg(pending_size_bytes),
    pending_sha256 = sqlc.arg(pending_sha256), updated_at = now()
WHERE id = sqlc.arg(id) AND owner_id = sqlc.arg(owner_id)
  AND status IN (4, 5) AND pending_status IN (0, 1, 5)
RETURNING *;

-- name: SetPendingStatus :one
UPDATE document.documents
SET pending_status = $2, pending_status_detail = $3, updated_at = now()
WHERE id = $1 AND pending_status <> 0
RETURNING *;

-- name: MarkPendingUploaded :one
UPDATE document.documents
SET pending_status = $2, pending_status_detail = $3, pending_size_bytes = $4, pending_content_type = $5,
    updated_at = now()
WHERE id = $1 AND pending_status <> 0
RETURNING *;

-- PromotePendingVersion makes an uploaded or processing (UPLOADED=2,
-- PROCESSING=3) pending version the document's current one. It runs with the
-- chunks of that version replacing the old ones (store.Repo.ReplaceChunks).
-- name: PromotePendingVersion :exec
UPDATE document.documents
SET version = version + 1, object_key = pending_object_key, filename = pending_filename,
    content_type = pending_content_type, size_bytes = pending_size_bytes, sha256 = pending_sha256,
    pending_status = 0, pending_status_detail = '', pending_object_key = '', pending_filename = '',
    pending_content_type = '', pending_size_bytes = 0, pending_sha256 = ''
WHERE id = $1 AND pending_status IN (2, 3);

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

-- ExistingObjectKeys returns those of keys that belong to a document, as its
-- file or as the file of its pending version.
-- name: ExistingObjectKeys :many
SELECT object_key FROM document.documents WHERE object_key = ANY(sqlc.arg(keys)::text[])
UNION
SELECT pending_object_key FROM document.documents WHERE pending_object_key = ANY(sqlc.arg(keys)::text[]);
