package grpcserver

import (
	"context"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

// The gRPC server metrics (docs/metrics.md). kb_platform.grpc records the
// same names and labels in the Python services.
var (
	rpcHandled = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "grpc_server_handled_total",
		Help: "RPCs completed by the server, by method and status code.",
	}, []string{"grpc_type", "grpc_service", "grpc_method", "grpc_code"})
	rpcDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "grpc_server_handling_seconds",
		Help: "Time the server took to complete an RPC, streams included.",
		// Up to the minutes a streamed answer from a local model can take.
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60, 120, 300},
	}, []string{"grpc_type", "grpc_service", "grpc_method"})
)

func metricsUnary(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	observe(info.FullMethod, "unary", start, err)
	return resp, err
}

func metricsStream(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	start := time.Now()
	err := handler(srv, ss)
	observe(info.FullMethod, streamType(info), start, err)
	return err
}

// observe records one completed RPC. Health checks, which probes make every
// few seconds, are left out.
func observe(fullMethod, kind string, start time.Time, err error) {
	service, method := splitMethod(fullMethod)
	if service == healthpb.Health_ServiceDesc.ServiceName {
		return
	}
	rpcHandled.WithLabelValues(kind, service, method, status.Code(err).String()).Inc()
	rpcDuration.WithLabelValues(kind, service, method).Observe(time.Since(start).Seconds())
}

func streamType(info *grpc.StreamServerInfo) string {
	switch {
	case info.IsClientStream && info.IsServerStream:
		return "bidi_stream"
	case info.IsClientStream:
		return "client_stream"
	default:
		return "server_stream"
	}
}

// splitMethod turns "/kb.x.v1.XService/Get" into "kb.x.v1.XService", "Get".
func splitMethod(fullMethod string) (service, method string) {
	service, method, ok := strings.Cut(strings.TrimPrefix(fullMethod, "/"), "/")
	if !ok {
		return "unknown", "unknown"
	}
	return service, method
}
