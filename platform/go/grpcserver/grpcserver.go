// Package grpcserver builds gRPC servers with the defaults every service
// needs: request logging, panic recovery, health checking and reflection.
package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"runtime/debug"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
)

// Server wraps a grpc.Server together with its health service.
type Server struct {
	*grpc.Server
	health *health.Server
	log    *slog.Logger
}

// New creates a server with logging and recovery interceptors installed.
func New(log *slog.Logger, opts ...grpc.ServerOption) *Server {
	opts = append([]grpc.ServerOption{
		grpc.ChainUnaryInterceptor(recoverUnary(log), userUnary, logUnary(log)),
		grpc.ChainStreamInterceptor(recoverStream(log), userStream, logStream(log)),
	}, opts...)
	s := &Server{Server: grpc.NewServer(opts...), health: health.NewServer(), log: log}
	healthpb.RegisterHealthServer(s.Server, s.health)
	reflection.Register(s.Server)
	return s
}

// Run serves on port until ctx is cancelled, then drains gracefully.
func (s *Server) Run(ctx context.Context, port int) error {
	lis, err := new(net.ListenConfig).Listen(ctx, "tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return err
	}
	for name := range s.GetServiceInfo() {
		s.health.SetServingStatus(name, healthpb.HealthCheckResponse_SERVING)
	}
	s.health.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)

	errc := make(chan error, 1)
	go func() { errc <- s.Serve(lis) }()
	s.log.InfoContext(ctx, "grpc server listening", "port", port)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	s.log.InfoContext(ctx, "shutting down")
	s.health.Shutdown()
	stopped := make(chan struct{})
	go func() { s.GracefulStop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		s.Stop()
	}
	return nil
}

func logUnary(log *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		logCall(ctx, log, info.FullMethod, start, err)
		return resp, err
	}
}

func logStream(log *slog.Logger) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		start := time.Now()
		err := handler(srv, ss)
		logCall(ss.Context(), log, info.FullMethod, start, err)
		return err
	}
}

func logCall(ctx context.Context, log *slog.Logger, method string, start time.Time, err error) {
	if method == healthpb.Health_Check_FullMethodName {
		return
	}
	code := status.Code(err)
	level := slog.LevelDebug
	switch code {
	case codes.OK, codes.Canceled:
	case codes.Internal, codes.Unknown, codes.DataLoss, codes.Unavailable:
		level = slog.LevelError
	default:
		level = slog.LevelWarn
	}
	log.Log(ctx, level, "rpc", "method", method, "code", code.String(),
		"duration_ms", time.Since(start).Milliseconds(), "error", err)
}

func recoverUnary(log *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp any, err error) {
		defer func() {
			if r := recover(); r != nil {
				log.ErrorContext(ctx, "panic", "method", info.FullMethod, "panic", r, "stack", string(debug.Stack()))
				err = status.Error(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, req)
	}
}

func recoverStream(log *slog.Logger) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) (err error) {
		defer func() {
			if r := recover(); r != nil {
				log.ErrorContext(ss.Context(), "panic", "method", info.FullMethod, "panic", r, "stack", string(debug.Stack()))
				err = status.Error(codes.Internal, "internal error")
			}
		}()
		return handler(srv, ss)
	}
}
