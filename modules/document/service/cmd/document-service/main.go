// Command document-service runs the document module's gRPC service.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/modules/document/service/internal/cleanup"
	"github.com/christoph/kb/modules/document/service/internal/embedcheck"
	"github.com/christoph/kb/modules/document/service/internal/events"
	"github.com/christoph/kb/modules/document/service/internal/server"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/store"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
	"github.com/christoph/kb/platform/go/config"
	"github.com/christoph/kb/platform/go/grpcserver"
	"github.com/christoph/kb/platform/go/logging"
	"github.com/christoph/kb/platform/go/metrics"
	"github.com/christoph/kb/platform/go/natsx"
	"github.com/christoph/kb/platform/go/postgres"
	"github.com/christoph/kb/platform/go/telemetry"
)

type Config struct {
	config.Base
	// DatabaseURL is the Postgres database holding the document schema.
	DatabaseURL string `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	// NATSURL is the NATS server with JetStream the reindex events are
	// published to (comma-separated for several).
	NATSURL string         `env:"NATS_URL" envDefault:"nats://localhost:4222"`
	Storage storage.Config `envPrefix:"S3_"`
	// LLMAddr is the llm module (host:port), needed by SearchDocuments and
	// the startup check of the embedding dimension.
	LLMAddr string `env:"LLM_ADDR" envDefault:"localhost:9004"`
	// Limits bound uploads: KB_MAX_UPLOAD_BYTES, KB_ALLOWED_CONTENT_TYPES.
	Limits server.Limits
	// Cleanup: KB_CLEANUP_INTERVAL, KB_UPLOAD_TTL, KB_ORPHAN_GRACE.
	Cleanup cleanup.Config
}

func (c Config) Validate(p *config.Problems) {
	c.Base.Validate(p)
	p.URL("KB_DATABASE_URL", c.DatabaseURL, "postgres", "postgresql")
	for _, server := range strings.Split(c.NATSURL, ",") {
		p.URL("KB_NATS_URL", strings.TrimSpace(server), "nats", "tls", "ws", "wss")
	}
	c.Storage.Validate(p)
	p.Addr("KB_LLM_ADDR", c.LLMAddr)
	c.Limits.Validate(p)
	c.Cleanup.Validate(p)
}

// loadConfig reads the configuration with the ports of module.yaml as defaults.
func loadConfig() (Config, error) {
	return config.Load(func(c *Config) { c.DefaultPorts(9001, 9101) })
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		// Before logging is set up: one plain message listing every problem.
		fmt.Fprintln(os.Stderr, "document-service:", err)
		os.Exit(1)
	}
	if err := run(cfg); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(cfg Config) error {
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

	// Reindex requests go out as events (ingestion consumes them).
	nc, js, err := natsx.Connect(cfg.NATSURL, "document-service")
	if err != nil {
		return err
	}
	defer nc.Close()
	if err := events.EnsureStream(ctx, js); err != nil {
		return err
	}

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

	// Says at startup, not on the first upload, when llm embeds with another
	// dimension than the chunk index has (see package embedcheck).
	dims, err := embedcheck.ColumnDimensions(ctx, pool)
	if err != nil {
		return err
	}
	llm := llmv1.NewLlmServiceClient(llmConn)
	go embedcheck.Run(ctx, dims, llm, embedcheck.DefaultBackoff, log)

	// Removes abandoned uploads and orphaned objects; replicas take turns.
	repo := store.NewRepo(pool)
	go cleanup.New(repo, objects, cfg.Cleanup, log).Run(ctx)

	srv := grpcserver.New(log)
	documentv1.RegisterDocumentServiceServer(srv, server.New(repo, objects, llm, cfg.Limits, log).WithReindexPublisher(events.NewPublisher(js)))
	return srv.Run(ctx, cfg.GRPCPort)
}
