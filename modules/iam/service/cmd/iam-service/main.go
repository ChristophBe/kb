// Command iam-service runs the iam module's gRPC service.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/migrations"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/server"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/config"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
	"github.com/ChristophBe/knowcelium/platform/go/logging"
	"github.com/ChristophBe/knowcelium/platform/go/metrics"
	"github.com/ChristophBe/knowcelium/platform/go/postgres"
	"github.com/ChristophBe/knowcelium/platform/go/telemetry"
)

type Config struct {
	config.Base
	// DatabaseURL is the Postgres database holding the iam schema.
	DatabaseURL string `env:"DATABASE_URL" envDefault:"postgres://kb:kb@localhost:5432/kb?sslmode=disable"`
	// BootstrapAdmins are the subjects or emails of the users who become
	// platform admins the first time they are seen (comma-separated). Later
	// admins are designated in the product; a user already registered is not
	// promoted by adding them here.
	BootstrapAdmins []string `env:"IAM_BOOTSTRAP_ADMINS" envSeparator:","`
}

func (c Config) Validate(p *config.Problems) {
	c.Base.Validate(p)
	p.URL("KNOWCEL_DATABASE_URL", c.DatabaseURL, "postgres", "postgresql")
}

// loadConfig reads the configuration with the ports of module.yaml as defaults.
func loadConfig() (Config, error) {
	return config.Load(func(c *Config) { c.DefaultPorts(9006, 9106) })
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		// Before logging is set up: one plain message listing every problem.
		fmt.Fprintln(os.Stderr, "iam-service:", err)
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
	log := logging.Setup(cfg.LogLevel, cfg.LogFormat, "iam-service")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdown, err := telemetry.Setup(ctx, cfg.OTelEndpoint, "iam-service")
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
	if err := postgres.Migrate(ctx, pool, "iam", migrations.FS, log); err != nil {
		return err
	}

	srv := grpcserver.New(log)
	iamv1.RegisterIamServiceServer(srv, server.New(store.NewRepo(pool), cfg.BootstrapAdmins, log))
	return srv.Run(ctx, cfg.GRPCPort)
}
