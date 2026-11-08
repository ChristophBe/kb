package grpcserver

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// UserHeader is the metadata key carrying the id of the calling user. Envoy
// sets it from the subject of the verified token and drops any value the
// client sent, so services can trust it on calls that came through the
// gateway.
const UserHeader = "x-kb-user"

type userKey struct{}

// UserFromContext returns the id of the user the call was made for, as put
// into the context by the server's user interceptor. ok is false for calls
// without a user, such as calls between services.
func UserFromContext(ctx context.Context) (user string, ok bool) {
	user, ok = ctx.Value(userKey{}).(string)
	return user, ok
}

// WithUser returns a context carrying user, for tests and code that acts on
// behalf of a user outside an RPC.
func WithUser(ctx context.Context, user string) context.Context {
	return context.WithValue(ctx, userKey{}, user)
}

// userFromMetadata puts the x-kb-user metadata of an incoming call, if any,
// into the context.
func userFromMetadata(ctx context.Context) context.Context {
	md, _ := metadata.FromIncomingContext(ctx)
	if v := md.Get(UserHeader); len(v) > 0 && v[0] != "" {
		return WithUser(ctx, v[0])
	}
	return ctx
}

func userUnary(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	return handler(userFromMetadata(ctx), req)
}

func userStream(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	return handler(srv, &userServerStream{ServerStream: ss, ctx: userFromMetadata(ss.Context())})
}

// userServerStream overrides the stream's context with one carrying the user.
type userServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *userServerStream) Context() context.Context { return s.ctx }
