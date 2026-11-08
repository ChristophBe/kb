package grpcserver

import (
	"log/slog"
	"net"
	"strings"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	reflectionpb "google.golang.org/grpc/reflection/grpc_reflection_v1"

	"github.com/christoph/kb/platform/go/telemetry"
)

// TestTracingSpansDialAndNew calls a server built by New through Dial with
// tracing on: the server's span continues the client's trace, and health
// checks are left out. It turns tracing on for the rest of the package's tests.
func TestTracingSpansDialAndNew(t *testing.T) {
	rec := tracetest.NewSpanRecorder()
	telemetry.Install(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec)))

	var lc net.ListenConfig
	lis, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := New(slog.New(slog.DiscardHandler))
	go srv.Serve(lis) //nolint:errcheck // stopped below
	t.Cleanup(srv.Stop)

	conn, err := Dial(lis.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := Probe(lis.Addr().(*net.TCPAddr).Port); err != nil {
		t.Fatal(err)
	}
	stream, err := reflectionpb.NewServerReflectionClient(conn).ServerReflectionInfo(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_ListServices{},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatal(err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatal(err)
	}
	_, _ = stream.Recv() // waits for the end of the call, which ends its spans
	srv.GracefulStop()

	var client, server sdktrace.ReadOnlySpan
	for _, s := range rec.Ended() {
		switch s.SpanKind() {
		case trace.SpanKindClient:
			client = s
		case trace.SpanKindServer:
			server = s
		}
		if strings.Contains(s.Name(), "Health") {
			t.Errorf("health check traced: %s", s.Name())
		}
	}
	if client == nil || server == nil {
		t.Fatalf("spans = %v, want a client and a server span", rec.Ended())
	}
	if server.Parent().SpanID() != client.SpanContext().SpanID() || server.SpanContext().TraceID() != client.SpanContext().TraceID() {
		t.Errorf("server span %v does not continue client span %v", server.SpanContext(), client.SpanContext())
	}
}
