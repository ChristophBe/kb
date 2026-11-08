-- name: DeleteChunks :exec
DELETE FROM document.chunks WHERE document_id = $1;

-- name: InsertChunks :copyfrom
INSERT INTO document.chunks (document_id, idx, text, metadata, embedding)
VALUES ($1, $2, $3, $4, $5);

-- SearchChunks returns the owner's chunks most similar to the embedding. The
-- HNSW index yields candidates before the owner filter applies, so the pool
-- sets hnsw.iterative_scan (store.ConfigurePool) to keep scanning until the
-- limit is filled.
-- name: SearchChunks :many
SELECT c.document_id, c.idx, c.text, c.metadata, d.title AS document_title,
       (1 - (c.embedding <=> sqlc.arg('embedding')::vector))::real AS score
FROM document.chunks c
JOIN document.documents d ON d.id = c.document_id
WHERE d.owner_id = sqlc.arg('owner_id')
  AND (cardinality(sqlc.arg('document_ids')::uuid[]) = 0
       OR c.document_id = ANY(sqlc.arg('document_ids')::uuid[]))
ORDER BY c.embedding <=> sqlc.arg('embedding')::vector
LIMIT sqlc.arg('max_results');

-- SearchBestChunks returns the most similar chunk of each of the owner's
-- documents, ranked by that chunk's score: the documents most similar to the
-- embedding. It is an exact scan, since the vector index can't pick one chunk
-- per document.
-- name: SearchBestChunks :many
SELECT document_id, idx, text, metadata, document_title, score
FROM (
    SELECT DISTINCT ON (c.document_id)
           c.document_id, c.idx, c.text, c.metadata, d.title AS document_title,
           (1 - (c.embedding <=> sqlc.arg('embedding')::vector))::real AS score
    FROM document.chunks c
    JOIN document.documents d ON d.id = c.document_id
    WHERE d.owner_id = sqlc.arg('owner_id')
      AND (cardinality(sqlc.arg('document_ids')::uuid[]) = 0
           OR c.document_id = ANY(sqlc.arg('document_ids')::uuid[]))
    ORDER BY c.document_id, c.embedding <=> sqlc.arg('embedding')::vector, c.idx
) best
ORDER BY score DESC, document_id
LIMIT sqlc.arg('max_results');

-- name: ListChunks :many
SELECT document_id, idx, text, metadata
FROM document.chunks
WHERE document_id = $1 AND idx > sqlc.arg('after_idx')
ORDER BY idx
LIMIT sqlc.arg('max_results');
