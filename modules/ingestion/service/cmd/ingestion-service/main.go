// Command ingestion-service runs the ingestion module's gRPC service and its
// processing-event consumer.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"golang.org/x/sync/errgroup"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/migrations"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/modules/ingestion/service/internal/documents"
	"github.com/christoph/kb/modules/ingestion/service/internal/events"
	"github.com/christoph/kb/modules/ingestion/service/internal/server"
	"github.com/christoph/kb/modules/ingestion/service/internal/store"
	"github.com/christoph/kb/platform/go/config"
	"github.com/christoph/kb/platform/go/grpcserver"
	"github.com/christoph/kb/platform/go/logging"
	"github.com/christoph/kb/platform/go/natsx"
	"github.com/christoph/kb/platform/go/postgres"
)

type Config struct {
	config.Base
	DatabaseURL  string `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	NATSURL      string `env:"NATS_URL" envDefault:"nats://localhost:4222"`
	DocumentAddr string `env:"DOCUMENT_ADDR" envDefault:"localhost:9001"`
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
		cfg.GRPCPort = 9002
	}
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		return grpcserver.Probe(cfg.GRPCPort)
	}
	log := logging.Setup(cfg.LogLevel, cfg.LogFormat, "ingestion-service")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

	service := app.New(
		store.NewJobs(store.New(pool)),
		documents.New(documentv1.NewDocumentServiceClient(conn)),
		events.NewPublisher(events.NewJetStream(js)),
	)
	srv := grpcserver.New(log)
	ingestionv1.RegisterIngestionServiceServer(srv, server.New(service, log))

	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error { return events.Consume(ctx, js, service, log) })
	g.Go(func() error { return srv.Run(ctx, cfg.GRPCPort) })
	return g.Wait()
}
