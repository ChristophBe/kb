// Command document-service runs the document module's gRPC service.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/modules/document/service/internal/cleanup"
	"github.com/christoph/kb/modules/document/service/internal/server"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/store"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
	"github.com/christoph/kb/platform/go/config"
	"github.com/christoph/kb/platform/go/grpcserver"
	"github.com/christoph/kb/platform/go/logging"
	"github.com/christoph/kb/platform/go/metrics"
	"github.com/christoph/kb/platform/go/postgres"
	"github.com/christoph/kb/platform/go/telemetry"
)

type Config struct {
	config.Base
	DatabaseURL string         `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	Storage     storage.Config `envPrefix:"S3_"`
	// LLMAddr is the llm module, needed only by SearchDocuments.
	LLMAddr string `env:"LLM_ADDR" envDefault:"localhost:9004"`
	// Limits bound uploads: KB_MAX_UPLOAD_BYTES, KB_ALLOWED_CONTENT_TYPES.
	Limits server.Limits
	// Cleanup: KB_CLEANUP_INTERVAL, KB_UPLOAD_TTL, KB_ORPHAN_GRACE.
	Cleanup cleanup.Config
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
	if cfg.MetricsPort == 0 {
		cfg.MetricsPort = 9101
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		return grpcserver.Probe(cfg.GRPCPort)
	}
	log := logging.Setup(cfg.LogLevel, cfg.LogFormat, "document-service")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdown, err := telemetry.Setup(ctx, cfg.OTelEndpoint, "document-service")
	if err != nil {
		return err
	}
	defer shutdown()
	if err := metrics.Start(ctx, cfg.MetricsPort, log); err != nil {
		return err
	}

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
	pool, err = postgres.Connect(ctx, cfg.DatabaseURL, store.ConfigurePool)
	if err != nil {
		return err
	}
	defer pool.Close()

	objects, err := storage.NewS3(ctx, cfg.Storage)
	if err != nil {
		return err
	}

	// The connection is lazy: the service starts and serves while llm is down.
	llmConn, err := grpcserver.Dial(cfg.LLMAddr)
	if err != nil {
		return err
	}
	defer llmConn.Close()

	// Removes abandoned uploads and orphaned objects; replicas take turns.
	repo := store.NewRepo(pool)
	go cleanup.New(repo, objects, cfg.Cleanup, log).Run(ctx)

	srv := grpcserver.New(log)
	documentv1.RegisterDocumentServiceServer(srv, server.New(repo, objects, llmv1.NewLlmServiceClient(llmConn), cfg.Limits, log))
	return srv.Run(ctx, cfg.GRPCPort)
}
