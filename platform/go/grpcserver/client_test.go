package grpcserver

import (
	"context"
	"net"
	"slices"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// userRecorder is a health server that records the user each call was made for.
type userRecorder struct {
	*health.Server
	seen []string
}

func (r *userRecorder) record(ctx context.Context) {
	user, _ := UserFromContext(ctx)
	r.seen = append(r.seen, user)
}

func (r *userRecorder) Check(ctx context.Context, req *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	r.record(ctx)
	return r.Server.Check(ctx, req)
}

func (r *userRecorder) Watch(req *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	r.record(stream.Context())
	return stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING})
}

// TestDialForwardsTheUser calls a server reading the user like New's through
// Dial, as one service calls another while handling a user's request.
func TestDialForwardsTheUser(t *testing.T) {
	var lc net.ListenConfig
	lis, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer(grpc.ChainUnaryInterceptor(userUnary), grpc.ChainStreamInterceptor(userStream))
	rec := &userRecorder{Server: health.NewServer()}
	healthpb.RegisterHealthServer(srv, rec)
	go srv.Serve(lis) //nolint:errcheck // stopped below
	t.Cleanup(srv.Stop)

	conn, err := Dial(lis.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := healthpb.NewHealthClient(conn)

	for _, ctx := range []context.Context{WithUser(t.Context(), "alice"), t.Context()} {
		if _, err := client.Check(ctx, &healthpb.HealthCheckRequest{}); err != nil {
			t.Fatal(err)
		}
		stream, err := client.Watch(ctx, &healthpb.HealthCheckRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := stream.Recv(); err != nil {
			t.Fatal(err)
		}
	}
	if want := []string{"alice", "alice", "", ""}; !slices.Equal(rec.seen, want) {
		t.Errorf("users seen = %q, want %q", rec.seen, want)
	}
}
