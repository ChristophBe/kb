package grpcserver

import (
	"context"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	"github.com/christoph/kb/platform/go/telemetry"
)

// Dial opens a client connection to another module's service. Calls made with
// a context carrying a user (see UserFromContext) pass that user on as
// x-kb-user, so the peer acts for the same user; calls without one, such as
// a worker's, reach the peer without a user. With tracing on, calls carry the
// context's trace on to the peer.
func Dial(target string) (*grpc.ClientConn, error) {
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(forwardUserUnary),
		grpc.WithChainStreamInterceptor(forwardUserStream),
	}
	if telemetry.Enabled() {
		opts = append(opts, grpc.WithStatsHandler(otelgrpc.NewClientHandler(otelgrpc.WithFilter(notHealth))))
	}
	return grpc.NewClient(target, opts...)
}

// withOutgoingUser adds the context's user, if any, to the outgoing metadata.
func withOutgoingUser(ctx context.Context) context.Context {
	if user, ok := UserFromContext(ctx); ok {
		return metadata.AppendToOutgoingContext(ctx, UserHeader, user)
	}
	return ctx
}

func forwardUserUnary(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	return invoker(withOutgoingUser(ctx), method, req, reply, cc, opts...)
}

func forwardUserStream(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, streamer grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	return streamer(withOutgoingUser(ctx), desc, cc, method, opts...)
}
