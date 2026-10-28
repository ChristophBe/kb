package grpcserver

import (
	"context"
	"fmt"
	"time"

	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// Probe checks the health service on localhost:port. Services expose it as a
// `healthcheck` subcommand so container images need no extra probe binary.
func Probe(port int) error {
	conn, err := Dial(fmt.Sprintf("localhost:%d", port))
	if err != nil {
		return err
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resp, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil {
		return err
	}
	if resp.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		return fmt.Errorf("status %s", resp.GetStatus())
	}
	return nil
}
