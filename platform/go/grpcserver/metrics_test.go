package grpcserver

import (
	"context"
	"errors"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

func TestMetricsCountCallsByCode(t *testing.T) {
	info := &grpc.UnaryServerInfo{FullMethod: "/kb.test.v1.TestService/Get"}
	ok := func(context.Context, any) (any, error) { return "ok", nil }
	missing := func(context.Context, any) (any, error) { return nil, status.Error(codes.NotFound, "no") }
	for _, h := range []grpc.UnaryHandler{ok, ok, missing} {
		_, _ = metricsUnary(t.Context(), nil, info, h)
	}
	if got := testutil.ToFloat64(rpcHandled.WithLabelValues("unary", "kb.test.v1.TestService", "Get", "OK")); got != 2 {
		t.Errorf("OK calls = %v, want 2", got)
	}
	if got := testutil.ToFloat64(rpcHandled.WithLabelValues("unary", "kb.test.v1.TestService", "Get", "NotFound")); got != 1 {
		t.Errorf("NotFound calls = %v, want 1", got)
	}
}

func TestMetricsLabelStreamsAndSkipHealth(t *testing.T) {
	stream := &grpc.StreamServerInfo{FullMethod: "/kb.test.v1.TestService/Watch", IsServerStream: true}
	_ = metricsStream(nil, nil, stream, func(any, grpc.ServerStream) error { return errors.New("boom") })
	if got := testutil.ToFloat64(rpcHandled.WithLabelValues("server_stream", "kb.test.v1.TestService", "Watch", "Unknown")); got != 1 {
		t.Errorf("stream calls = %v, want 1", got)
	}

	before := testutil.CollectAndCount(rpcHandled)
	health := &grpc.UnaryServerInfo{FullMethod: healthpb.Health_Check_FullMethodName}
	_, _ = metricsUnary(t.Context(), nil, health, func(context.Context, any) (any, error) { return nil, nil })
	if after := testutil.CollectAndCount(rpcHandled); after != before {
		t.Errorf("health check recorded: %d series before, %d after", before, after)
	}
}
