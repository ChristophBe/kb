package grpcserver

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"slices"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

var discard = slog.New(slog.DiscardHandler)

func TestPrincipalHelpers(t *testing.T) {
	p := Principal{UserID: "ann", Teams: []Team{{ID: "a", Admin: true}, {ID: "b"}}}
	if got := p.TeamIDs(); !slices.Equal(got, []string{"a", "b"}) {
		t.Errorf("TeamIDs = %v", got)
	}
	if !p.IsTeamAdmin("a") || p.IsTeamAdmin("b") || p.IsTeamAdmin("c") {
		t.Error("IsTeamAdmin wrong")
	}
	ctx := WithPrincipal(t.Context(), p)
	if got, ok := PrincipalFromContext(ctx); !ok || got.UserID != "ann" {
		t.Errorf("PrincipalFromContext = %v, %v", got, ok)
	}
	if user, ok := UserFromContext(ctx); !ok || user != "ann" {
		t.Errorf("UserFromContext = %q, %v", user, ok)
	}
	if _, ok := PrincipalFromContext(t.Context()); ok {
		t.Error("an empty context has a principal")
	}
}

// clock is a controllable time source for the resolver.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestResolverCachesUntilTheTTLExpires(t *testing.T) {
	calls := 0
	r := NewResolver(func(_ context.Context, user string) (Principal, error) {
		calls++
		return Principal{UserID: user, Teams: []Team{{ID: "t1"}}}, nil
	}, time.Minute, discard)
	c := &clock{t: time.Unix(1000, 0)}
	r.now = c.now

	for range 3 {
		if p := r.Resolve(t.Context(), "ann"); len(p.Teams) != 1 {
			t.Fatalf("principal = %+v", p)
		}
	}
	if calls != 1 {
		t.Fatalf("lookups = %d, want 1 (cached)", calls)
	}
	r.Resolve(t.Context(), "bob")
	if calls != 2 {
		t.Errorf("lookups after another user = %d, want 2", calls)
	}
	c.t = c.t.Add(time.Minute + time.Second)
	r.Resolve(t.Context(), "ann")
	if calls != 3 {
		t.Errorf("lookups after the TTL = %d, want 3", calls)
	}
}

func TestResolverWithoutIAMHasNoTeams(t *testing.T) {
	calls := 0
	fail := true
	r := NewResolver(func(_ context.Context, user string) (Principal, error) {
		calls++
		if fail {
			return Principal{}, errors.New("iam unavailable")
		}
		return Principal{Teams: []Team{{ID: "t1"}}, PlatformAdmin: true}, nil
	}, time.Minute, discard)
	c := &clock{t: time.Unix(1000, 0)}
	r.now = c.now

	p := r.Resolve(t.Context(), "ann")
	if p.UserID != "ann" || len(p.Teams) != 0 || p.PlatformAdmin || !p.Unavailable {
		t.Fatalf("degraded principal = %+v, want ann without teams, marked unavailable", p)
	}
	r.Resolve(t.Context(), "ann")
	if calls != 1 {
		t.Errorf("lookups during the outage = %d, want 1 (failure cached briefly)", calls)
	}
	fail = false
	c.t = c.t.Add(failureTTL + time.Second)
	if p := r.Resolve(t.Context(), "ann"); len(p.Teams) != 1 || !p.PlatformAdmin || p.Unavailable {
		t.Errorf("principal after recovery = %+v", p)
	}
}

func TestResolverDoesNotCacheACancelledCall(t *testing.T) {
	calls := 0
	r := NewResolver(func(ctx context.Context, user string) (Principal, error) {
		calls++
		if err := ctx.Err(); err != nil {
			return Principal{}, err
		}
		return Principal{Teams: []Team{{ID: "t1"}}}, nil
	}, time.Minute, discard)

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if p := r.Resolve(ctx, "ann"); len(p.Teams) != 0 {
		t.Fatalf("principal of a cancelled call = %+v", p)
	}
	if p := r.Resolve(t.Context(), "ann"); len(p.Teams) != 1 || calls != 2 {
		t.Errorf("principal after = %+v, lookups = %d; want teams and 2 lookups", p, calls)
	}
}

// principalRecorder is a health server that records the principal of each call.
type principalRecorder struct {
	*health.Server
	seen []Principal
	ok   []bool
}

func (r *principalRecorder) Check(ctx context.Context, req *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	p, ok := PrincipalFromContext(ctx)
	r.seen, r.ok = append(r.seen, p), append(r.ok, ok)
	return r.Server.Check(ctx, req)
}

func (r *principalRecorder) Watch(_ *healthpb.HealthCheckRequest, stream grpc.ServerStreamingServer[healthpb.HealthCheckResponse]) error {
	p, ok := PrincipalFromContext(stream.Context())
	r.seen, r.ok = append(r.seen, p), append(r.ok, ok)
	return stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING})
}

// TestPrincipalsInterceptorResolvesTheCaller serves through New's user
// interceptors plus Principals and calls it through Dial, as a service
// handling a user's request calls another.
func TestPrincipalsInterceptorResolvesTheCaller(t *testing.T) {
	var resolved []string
	r := NewResolver(func(ctx context.Context, user string) (Principal, error) {
		if got, _ := UserFromContext(ctx); got != user {
			t.Errorf("the lookup context carries user %q, want %q", got, user)
		}
		resolved = append(resolved, user)
		return Principal{PlatformAdmin: true, Teams: []Team{{ID: "t1", Admin: true}}}, nil
	}, time.Minute, discard)

	var lc net.ListenConfig
	lis, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	opts := append([]grpc.ServerOption{
		grpc.ChainUnaryInterceptor(userUnary), grpc.ChainStreamInterceptor(userStream),
	}, Principals(r)...)
	srv := grpc.NewServer(opts...)
	rec := &principalRecorder{Server: health.NewServer()}
	healthpb.RegisterHealthServer(srv, rec)
	go srv.Serve(lis) //nolint:errcheck // stopped below
	t.Cleanup(srv.Stop)

	conn, err := Dial(lis.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := healthpb.NewHealthClient(conn)

	// A call for a user, unary and streamed, then one without a user.
	ctx := WithUser(t.Context(), "ann")
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
	if _, err := client.Check(t.Context(), &healthpb.HealthCheckRequest{}); err != nil {
		t.Fatal(err)
	}

	if len(rec.seen) != 3 {
		t.Fatalf("handler calls = %d, want 3", len(rec.seen))
	}
	for i := range 2 {
		p := rec.seen[i]
		if !rec.ok[i] || p.UserID != "ann" || !p.PlatformAdmin || !p.IsTeamAdmin("t1") {
			t.Errorf("call %d principal = %+v, %v", i, p, rec.ok[i])
		}
	}
	if rec.ok[2] {
		t.Errorf("the call without a user has principal %+v", rec.seen[2])
	}
	if !slices.Equal(resolved, []string{"ann"}) {
		t.Errorf("lookups = %v, want one (cached)", resolved)
	}
}
