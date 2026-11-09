// Package postgres connects to Postgres and applies a module's migrations.
package postgres

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"

	"github.com/christoph/kb/platform/go/telemetry"
)

// Connect opens a connection pool and verifies it with a ping. Options can
// adjust the pool config, e.g. to register extension types in AfterConnect.
// With tracing on, every query gets a span.
func Connect(ctx context.Context, url string, opts ...func(*pgxpool.Config)) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if telemetry.Enabled() {
		cfg.ConnConfig.Tracer = otelpgx.NewTracer(otelpgx.WithDisableAcquireTracer())
	}
	for _, opt := range opts {
		opt(cfg)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return pool, nil
}

// Migrate applies a module's goose migrations. Each module tracks its version
// in its own table, so modules migrate independently.
func Migrate(ctx context.Context, pool *pgxpool.Pool, module string, migrations fs.FS, log *slog.Logger) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()

	store, err := database.NewStore(database.DialectPostgres, module+"_schema_migrations")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider("", db, migrations, goose.WithStore(store))
	if err != nil {
		return err
	}
	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("migrate %s: %w", module, err)
	}
	for _, r := range results {
		log.InfoContext(ctx, "applied migration", "module", module, "version", r.Source.Version, "path", r.Source.Path)
	}
	return nil
}
