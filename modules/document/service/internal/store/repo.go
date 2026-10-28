package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo adds multi-statement operations on top of the generated queries.
type Repo struct {
	*Queries
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{Queries: New(pool), pool: pool}
}

// ReplaceChunks atomically swaps a document's chunks and marks it ready.
func (r *Repo) ReplaceChunks(ctx context.Context, documentID uuid.UUID, chunks []InsertChunksParams, readyStatus int16) (int32, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	q := r.WithTx(tx)
	if err := q.DeleteChunks(ctx, documentID); err != nil {
		return 0, err
	}
	n, err := q.InsertChunks(ctx, chunks)
	if err != nil {
		return 0, fmt.Errorf("insert chunks: %w", err)
	}
	if err := q.SetChunkCount(ctx, SetChunkCountParams{ID: documentID, ChunkCount: int32(n), Status: readyStatus}); err != nil {
		return 0, err
	}
	return int32(n), tx.Commit(ctx)
}
