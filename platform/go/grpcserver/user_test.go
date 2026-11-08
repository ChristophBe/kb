package grpcserver

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestUserUnaryReadsUserHeader(t *testing.T) {
	for name, tc := range map[string]struct {
		md     metadata.MD
		want   string
		wantOK bool
	}{
		"user":        {md: metadata.Pairs(UserHeader, "alice"), want: "alice", wantOK: true},
		"no metadata": {},
		"empty":       {md: metadata.Pairs(UserHeader, "")},
	} {
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			if tc.md != nil {
				ctx = metadata.NewIncomingContext(ctx, tc.md)
			}
			var got string
			var ok bool
			_, err := userUnary(ctx, nil, &grpc.UnaryServerInfo{}, func(ctx context.Context, _ any) (any, error) {
				got, ok = UserFromContext(ctx)
				return nil, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want || ok != tc.wantOK {
				t.Errorf("UserFromContext = %q, %v; want %q, %v", got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

type fakeStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s fakeStream) Context() context.Context { return s.ctx }

func TestUserStreamReadsUserHeader(t *testing.T) {
	ctx := metadata.NewIncomingContext(t.Context(), metadata.Pairs(UserHeader, "bob"))
	var got string
	err := userStream(nil, fakeStream{ctx: ctx}, &grpc.StreamServerInfo{}, func(_ any, ss grpc.ServerStream) error {
		got, _ = UserFromContext(ss.Context())
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != "bob" {
		t.Errorf("UserFromContext = %q, want bob", got)
	}
}

func TestWithUser(t *testing.T) {
	if _, ok := UserFromContext(t.Context()); ok {
		t.Error("UserFromContext on a bare context reports a user")
	}
	if got, _ := UserFromContext(WithUser(t.Context(), "carol")); got != "carol" {
		t.Errorf("UserFromContext = %q, want carol", got)
	}
}
