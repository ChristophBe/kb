// Package metrics serves the process's Prometheus metrics on their own HTTP
// port (KB_METRICS_PORT), apart from the gRPC port, so scraping needs no gRPC
// and no token. Metrics register with the default registry (promauto), which
// also carries the Go runtime and process collectors. Names and labels are
// listed in docs/metrics.md; labels never carry user or document ids.
package metrics

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Path is where the metrics are served.
const Path = "/metrics"

// Handler serves the default registry. A collector that fails (e.g. one that
// queries a database that is down) leaves out its own metrics, not the rest.
func Handler() http.Handler {
	return promhttp.HandlerFor(prometheus.DefaultGatherer, promhttp.HandlerOpts{
		ErrorHandling: promhttp.ContinueOnError,
	})
}

// Start serves Handler on port until ctx is cancelled. It returns once the
// port is bound, so a port in use fails the service at startup.
func Start(ctx context.Context, port int, log *slog.Logger) error {
	lis, err := new(net.ListenConfig).Listen(ctx, "tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("metrics listener: %w", err)
	}
	mux := http.NewServeMux()
	mux.Handle(Path, Handler())
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := srv.Serve(lis); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.ErrorContext(ctx, "metrics server stopped", "error", err)
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.InfoContext(ctx, "metrics server listening", "port", port, "path", Path)
	return nil
}
