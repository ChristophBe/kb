// Package embedcheck compares the dimension of the chunk index's vector
// column with the dimension the llm module embeds with
// (KB_EMBEDDING_DIMENSIONS of the llm service). When they differ, every
// AddChunks and every search fails, so the service says so at startup rather
// than on the first upload.
//
// Each side reports its own value: the column comes from this module's
// schema, the llm dimension from the llm module's GetProviderStatus. llm is a
// soft dependency, so the check waits for it in the background and never
// stops the service; a mismatch is logged as an error.
package embedcheck

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc"

	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
)

// Status is the part of the llm client the check needs.
type Status interface {
	GetProviderStatus(ctx context.Context, in *llmv1.GetProviderStatusRequest, opts ...grpc.CallOption) (*llmv1.GetProviderStatusResponse, error)
}

// Querier runs the column lookup; a *pgxpool.Pool is one.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// For pgvector, the type modifier of a vector(n) column is n.
const columnQuery = `SELECT atttypmod FROM pg_attribute
WHERE attrelid = 'document.chunks'::regclass AND attname = 'embedding'`

// ColumnDimensions returns n of the chunk index's vector(n) column.
func ColumnDimensions(ctx context.Context, db Querier) (int, error) {
	var n int
	if err := db.QueryRow(ctx, columnQuery).Scan(&n); err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, errors.New("document.chunks.embedding has no dimension")
	}
	return n, nil
}

// Backoff bounds the wait between attempts to reach llm.
type Backoff struct {
	Initial, Max time.Duration
}

// DefaultBackoff starts at a second and settles at a minute.
var DefaultBackoff = Backoff{Initial: time.Second, Max: time.Minute}

// Run asks llm for its embedding dimension until it answers or ctx ends,
// then logs whether it matches column. It reports the outcome: true when the
// dimensions match, false on a mismatch or when ctx ended first.
func Run(ctx context.Context, column int, llm Status, backoff Backoff, log *slog.Logger) bool {
	delay := backoff.Initial
	for {
		resp, err := llm.GetProviderStatus(ctx, &llmv1.GetProviderStatusRequest{})
		if err == nil {
			return compare(column, int(resp.GetEmbeddingDimensions()), log)
		}
		log.DebugContext(ctx, "embedding dimension check: llm not reachable yet", "error", err)
		select {
		case <-ctx.Done():
			return false
		case <-time.After(delay):
		}
		delay = min(2*delay, backoff.Max)
	}
}

func compare(column, llm int, log *slog.Logger) bool {
	if llm == column {
		log.Info("embedding dimensions match the llm module", "dimensions", column)
		return true
	}
	log.Error("embedding dimensions differ: uploads cannot be indexed and search fails until they match",
		"llm_dimensions", llm, "column_dimensions", column,
		"fix", "set KB_EMBEDDING_DIMENSIONS of the llm service to the chunk index's dimension, "+
			"or change the vector column with a new migration in modules/document/migrations")
	return false
}
