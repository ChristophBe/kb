-- name: DeleteChunks :exec
DELETE FROM document.chunks WHERE document_id = $1;

-- name: InsertChunks :copyfrom
INSERT INTO document.chunks (document_id, idx, text, metadata, embedding, embedding_model)
VALUES ($1, $2, $3, $4, $5, $6);

-- SearchChunks returns the chunks of the public documents, the owner's and
-- those of team_ids that are most similar to the embedding, among those made by
-- the same embedding model: vectors of different models are not comparable.
-- The HNSW index yields candidates before the visibility filter applies, so the pool
-- sets hnsw.iterative_scan (store.ConfigurePool) to keep scanning until the
-- limit is filled. only_team_ids, when not empty, further limits the search
-- to the documents attached to one of those teams (not the public ones).
-- name: SearchChunks :many
SELECT c.document_id, c.idx, c.text, c.metadata, d.title AS document_title,
       (1 - (c.embedding <=> sqlc.arg('embedding')::vector))::real AS score
FROM document.chunks c
JOIN document.documents d ON d.id = c.document_id
WHERE (d.access = 1
       OR d.owner_id = sqlc.arg('owner_id')
       OR EXISTS (SELECT 1 FROM document.document_teams t
                  WHERE t.document_id = d.id AND t.team_id = ANY(sqlc.arg('team_ids')::uuid[])))
  AND c.embedding_model = sqlc.arg('embedding_model')
  AND (cardinality(sqlc.arg('document_ids')::uuid[]) = 0
       OR c.document_id = ANY(sqlc.arg('document_ids')::uuid[]))
  AND (coalesce(cardinality(sqlc.arg('only_team_ids')::uuid[]), 0) = 0
       OR EXISTS (SELECT 1 FROM document.document_teams o
                  WHERE o.document_id = d.id AND o.team_id = ANY(sqlc.arg('only_team_ids')::uuid[])))
ORDER BY c.embedding <=> sqlc.arg('embedding')::vector
LIMIT sqlc.arg('max_results');

-- SearchBestChunks returns the most similar chunk of each of the documents
-- visible as in SearchChunks, ranked by that chunk's score: the documents most similar to the
-- embedding. It is an exact scan, since the vector index can't pick one chunk
-- per document. Only chunks of the embedding's model are compared, as in
-- SearchChunks.
-- name: SearchBestChunks :many
SELECT document_id, idx, text, metadata, document_title, score
FROM (
    SELECT DISTINCT ON (c.document_id)
           c.document_id, c.idx, c.text, c.metadata, d.title AS document_title,
           (1 - (c.embedding <=> sqlc.arg('embedding')::vector))::real AS score
    FROM document.chunks c
    JOIN document.documents d ON d.id = c.document_id
    WHERE (d.access = 1
           OR d.owner_id = sqlc.arg('owner_id')
           OR EXISTS (SELECT 1 FROM document.document_teams t
                      WHERE t.document_id = d.id AND t.team_id = ANY(sqlc.arg('team_ids')::uuid[])))
      AND c.embedding_model = sqlc.arg('embedding_model')
      AND (cardinality(sqlc.arg('document_ids')::uuid[]) = 0
           OR c.document_id = ANY(sqlc.arg('document_ids')::uuid[]))
      AND (coalesce(cardinality(sqlc.arg('only_team_ids')::uuid[]), 0) = 0
           OR EXISTS (SELECT 1 FROM document.document_teams o
                      WHERE o.document_id = d.id AND o.team_id = ANY(sqlc.arg('only_team_ids')::uuid[])))
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

-- ListReindexTargets returns the owner's READY documents (status 4) to
-- reindex: those with a chunk made by a model other than embedding_model, or
-- all of them with force. Documents with a pending version (a new file being
-- uploaded or processed, or one that failed) are left out: the new file
-- becomes their chunks, embedded by the current model. With document_ids
-- the choice is limited to those documents.
-- name: ListReindexTargets :many
SELECT d.id
FROM document.documents d
WHERE d.owner_id = sqlc.arg('owner_id')
  AND d.status = 4
  AND d.pending_status = 0
  AND (cardinality(sqlc.arg('document_ids')::uuid[]) = 0
       OR d.id = ANY(sqlc.arg('document_ids')::uuid[]))
  AND (sqlc.arg('force')::bool
       OR EXISTS (SELECT 1 FROM document.chunks c
                  WHERE c.document_id = d.id AND c.embedding_model <> sqlc.arg('embedding_model')::text))
ORDER BY d.created_at, d.id;
