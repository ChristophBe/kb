// Command ingestion-service runs the ingestion module's gRPC service and its
// processing-event consumer.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"golang.org/x/sync/errgroup"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
	"github.com/ChristophBe/knowcelium/modules/ingestion/migrations"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/app"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/documents"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/events"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/fetch"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/server"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/config"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
	"github.com/ChristophBe/knowcelium/platform/go/logging"
	"github.com/ChristophBe/knowcelium/platform/go/metrics"
	"github.com/ChristophBe/knowcelium/platform/go/natsx"
	"github.com/ChristophBe/knowcelium/platform/go/postgres"
	"github.com/ChristophBe/knowcelium/platform/go/telemetry"
)

type Config struct {
	config.Base
	// DatabaseURL is the Postgres database holding the ingestion schema.
	DatabaseURL string `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	// NATSURL is the NATS server with JetStream that carries the
	// knowcel.ingestion.* events (comma-separated for a cluster).
	NATSURL string `env:"NATS_URL" envDefault:"nats://localhost:4222"`
	// DocumentAddr is the document module (host:port), where uploads are
	// created and their status is set.
	DocumentAddr string `env:"DOCUMENT_ADDR" envDefault:"localhost:9001"`
	// URLMaxBytes is the largest page accepted when ingesting from a URL.
	URLMaxBytes int64 `env:"URL_MAX_BYTES" envDefault:"20971520"`
	// URLTimeout bounds fetching one page.
	URLTimeout time.Duration `env:"URL_TIMEOUT" envDefault:"20s"`
	// UploadEndpoint is the S3 address (host:port) this service uploads
	// fetched pages to, if the upload URLs of the document module (signed for
	// the address browsers use) are not reachable from here.
	UploadEndpoint string `env:"UPLOAD_ENDPOINT"`
}

func (c Config) Validate(p *config.Problems) {
	c.Base.Validate(p)
	p.URL("KNOWCEL_DATABASE_URL", c.DatabaseURL, "postgres", "postgresql")
	// A comma-separated list names several servers of one cluster.
	for _, server := range strings.Split(c.NATSURL, ",") {
		p.URL("KNOWCEL_NATS_URL", strings.TrimSpace(server), "nats", "tls", "ws", "wss")
	}
	p.Addr("KNOWCEL_DOCUMENT_ADDR", c.DocumentAddr)
	if c.URLMaxBytes < 1 {
		p.Addf("KNOWCEL_URL_MAX_BYTES", "must be at least 1, got %d", c.URLMaxBytes)
	}
	if c.URLTimeout <= 0 {
		p.Addf("KNOWCEL_URL_TIMEOUT", "must be positive, got %s", c.URLTimeout)
	}
	if c.UploadEndpoint != "" {
		p.Addr("KNOWCEL_UPLOAD_ENDPOINT", c.UploadEndpoint)
	}
}

// loadConfig reads the configuration with the ports of module.yaml as defaults.
func loadConfig() (Config, error) {
	return config.Load(func(c *Config) { c.DefaultPorts(9002, 9102) })
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		// Before logging is set up: one plain message listing every problem.
		fmt.Fprintln(os.Stderr, "ingestion-service:", err)
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
	log := logging.Setup(cfg.LogLevel, cfg.LogFormat, "ingestion-service")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdown, err := telemetry.Setup(ctx, cfg.OTelEndpoint, "ingestion-service")
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
	defer pool.Close()
	if err := postgres.Migrate(ctx, pool, "ingestion", migrations.FS, log); err != nil {
		return err
	}

	nc, js, err := natsx.Connect(cfg.NATSURL, "ingestion-service")
	if err != nil {
		return err
	}
	defer nc.Close()
	if err := events.EnsureStream(ctx, js); err != nil {
		return err
	}

	conn, err := grpcserver.Dial(cfg.DocumentAddr)
	if err != nil {
		return err
	}
	defer conn.Close()

	queries := store.New(pool)
	prometheus.MustRegister(store.NewJobsCollector(queries))
	service := app.New(
		store.NewJobs(queries),
		documents.New(documentv1.NewDocumentServiceClient(conn)),
		events.NewPublisher(events.NewJetStream(js)),
	).WithURLImport(
		fetch.New(fetch.Options{MaxBytes: cfg.URLMaxBytes, Timeout: cfg.URLTimeout}),
		documents.NewUploader(cfg.UploadEndpoint),
	)
	srv := grpcserver.New(log)
	ingestionv1.RegisterIngestionServiceServer(srv, server.New(service, log))

	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error { return events.Consume(ctx, js, service, log) })
	g.Go(func() error { return events.ConsumeReindex(ctx, js, service, log) })
	g.Go(func() error { return srv.Run(ctx, cfg.GRPCPort) })
	return g.Wait()
}
