// Command document-service runs the document module's gRPC service.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxvec "github.com/pgvector/pgvector-go/pgx"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/modules/document/service/internal/server"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/config"
	"github.com/christoph/kb/platform/go/grpcserver"
	"github.com/christoph/kb/platform/go/logging"
	"github.com/christoph/kb/platform/go/postgres"
)

type Config struct {
	config.Base
	DatabaseURL string         `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	Storage     storage.Config `envPrefix:"S3_"`
}

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load[Config]()
	if err != nil {
		return err
	}
	if cfg.GRPCPort == 0 {
		cfg.GRPCPort = 9001
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		return grpcserver.Probe(cfg.GRPCPort)
	}
	log := logging.Setup(cfg.LogLevel, cfg.LogFormat, "document-service")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	if err := postgres.Migrate(ctx, pool, "document", migrations.FS, log); err != nil {
		return err
	}
	// The vector type exists only after the first migration, so the pool
	// that registers it is opened afterwards.
	pool.Close()
	pool, err = postgres.Connect(ctx, cfg.DatabaseURL, func(c *pgxpool.Config) {
		c.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			return pgxvec.RegisterTypes(ctx, conn)
		}
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	objects, err := storage.NewS3(ctx, cfg.Storage)
	if err != nil {
		return err
	}

	srv := grpcserver.New(log)
	documentv1.RegisterDocumentServiceServer(srv, server.New(store.NewRepo(pool), objects, log))
	return srv.Run(ctx, cfg.GRPCPort)
}
