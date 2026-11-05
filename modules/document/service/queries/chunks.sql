-- name: DeleteChunks :exec
DELETE FROM document.chunks WHERE document_id = $1;

-- name: InsertChunks :copyfrom
INSERT INTO document.chunks (document_id, idx, text, metadata, embedding)
VALUES ($1, $2, $3, $4, $5);

-- name: SearchChunks :many
SELECT c.document_id, c.idx, c.text, c.metadata, d.title AS document_title,
       (1 - (c.embedding <=> sqlc.arg('embedding')::vector))::real AS score
FROM document.chunks c
JOIN document.documents d ON d.id = c.document_id
WHERE cardinality(sqlc.arg('document_ids')::uuid[]) = 0
   OR c.document_id = ANY(sqlc.arg('document_ids')::uuid[])
ORDER BY c.embedding <=> sqlc.arg('embedding')::vector
LIMIT sqlc.arg('max_results');

-- name: ListChunks :many
SELECT document_id, idx, text, metadata
FROM document.chunks
WHERE document_id = $1 AND idx > sqlc.arg('after_idx')
ORDER BY idx
LIMIT sqlc.arg('max_results');
