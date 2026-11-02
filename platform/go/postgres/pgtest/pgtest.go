// Package pgtest runs a real Postgres for integration tests. Tests using it
// carry the integration build tag, so that `task test` needs no Docker.
package pgtest

import (
	"context"
	"io/fs"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/christoph/kb/platform/go/postgres"
)

// Image is the image of deploy/infra.compose.yaml, so tests see the same pgvector.
const Image = "pgvector/pgvector:pg17"

// Start runs a container for this test, applies a module's migrations and
// returns a pool on it. The container is removed when the test ends. Options
// apply as in postgres.Connect; they take effect after the migrations, because
// extension types only exist from then on.
func Start(t testing.TB, module string, migrations fs.FS, opts ...func(*pgxpool.Config)) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	container, err := tcpostgres.Run(ctx, Image,
		tcpostgres.WithDatabase("kb"),
		tcpostgres.WithUsername("kb"),
		tcpostgres.WithPassword("kb"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() {
		if err := container.Terminate(ctx); err != nil {
			t.Errorf("stop postgres: %v", err)
		}
	})
	url, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("postgres url: %v", err)
	}

	setup, err := postgres.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer setup.Close()
	if err := postgres.Migrate(ctx, setup, module, migrations, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	pool, err := postgres.Connect(ctx, url, opts...)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
