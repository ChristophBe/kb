package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxvec "github.com/pgvector/pgvector-go/pgx"
)

// ConfigurePool prepares each connection of the pool the queries run on: it
// registers the vector type and turns on pgvector's iterative index scans.
// Without them, an HNSW scan returns its candidate list (hnsw.ef_search, 40
// chunks) before the owner filter of SearchChunks applies, so a user whose
// documents are a small part of the index would get few or no results.
func ConfigurePool(c *pgxpool.Config) {
	c.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if err := pgxvec.RegisterTypes(ctx, conn); err != nil {
			return err
		}
		_, err := conn.Exec(ctx, "SET hnsw.iterative_scan = strict_order")
		return err
	}
}

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

// WithLock runs fn while holding the Postgres advisory lock key, so that of
// several replicas only one runs fn at a time. It returns false without
// running fn when another holds the lock. The lock is held by a transaction
// that fn does not use, and ends with it even if the connection breaks.
func (r *Repo) WithLock(ctx context.Context, key int64, fn func(context.Context) error) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // releases the lock; nothing to commit
	var locked bool
	if err := tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", key).Scan(&locked); err != nil {
		return false, fmt.Errorf("advisory lock: %w", err)
	}
	if !locked {
		return false, nil
	}
	return true, fn(ctx)
}
