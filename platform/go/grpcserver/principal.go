package grpcserver

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"google.golang.org/grpc"
)

// Team is a team a user belongs to, with their role in it.
type Team struct {
	ID    string
	Admin bool
}

// Principal is the caller of a user-facing call: who they are and what they
// may reach. Modules use it to decide which documents a call may see.
type Principal struct {
	UserID        string
	PlatformAdmin bool
	Teams         []Team
	// Unavailable is set when the principal could not be resolved, for
	// instance because IAM is down: Teams and PlatformAdmin are then empty
	// without being known to be. Calls that depend on teams should fail with
	// UNAVAILABLE rather than treat the caller as having none.
	Unavailable bool
}

// TeamIDs returns the ids of all teams the user belongs to.
func (p Principal) TeamIDs() []string {
	ids := make([]string, len(p.Teams))
	for i, t := range p.Teams {
		ids[i] = t.ID
	}
	return ids
}

// IsTeamAdmin reports whether the user is an admin of the team.
func (p Principal) IsTeamAdmin(teamID string) bool {
	for _, t := range p.Teams {
		if t.ID == teamID {
			return t.Admin
		}
	}
	return false
}

type principalKey struct{}

// PrincipalFromContext returns the principal of the call, as put into the
// context by the server's principal interceptor (see Principals). ok is false
// for calls without a user and for servers without a resolver.
func PrincipalFromContext(ctx context.Context) (p Principal, ok bool) {
	p, ok = ctx.Value(principalKey{}).(Principal)
	return p, ok
}

// WithPrincipal returns a context carrying p and its user, for tests and
// code that acts on behalf of a user outside an RPC.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(WithUser(ctx, p.UserID), principalKey{}, p)
}

// ResolveFunc looks up the principal of a user, normally through the IAM
// module's generated client (platform code must not import a module). The
// context carries the user, so a call made with a client from Dial acts for
// them.
type ResolveFunc func(ctx context.Context, user string) (Principal, error)

const (
	// DefaultPrincipalTTL is how long a resolved principal is reused, so
	// membership changes reach other modules within this time.
	DefaultPrincipalTTL = 30 * time.Second
	// failureTTL is how long a failed resolution is reused, so an IAM outage
	// does not add a failing call to every request.
	failureTTL = 5 * time.Second
	// resolveTimeout bounds a lookup, so a hung IAM delays a call only briefly.
	resolveTimeout = 2 * time.Second
)

// Resolver resolves principals through a ResolveFunc and caches the results.
// When the lookup fails, for instance because IAM is down, the principal has
// no teams and no admin rights, and is marked Unavailable: access that needs
// no team keeps working.
type Resolver struct {
	resolve ResolveFunc
	ttl     time.Duration
	log     *slog.Logger
	now     func() time.Time

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	p       Principal
	expires time.Time
}

// NewResolver returns a Resolver that reuses each principal for ttl.
func NewResolver(resolve ResolveFunc, ttl time.Duration, log *slog.Logger) *Resolver {
	return &Resolver{resolve: resolve, ttl: ttl, log: log, now: time.Now, cache: map[string]cached{}}
}

// Resolve returns the principal of user. It never fails: see Resolver.
func (r *Resolver) Resolve(ctx context.Context, user string) Principal {
	r.mu.Lock()
	c, ok := r.cache[user]
	r.mu.Unlock()
	if ok && r.now().Before(c.expires) {
		return c.p
	}
	parent := ctx
	ctx, cancel := context.WithTimeout(ctx, resolveTimeout)
	defer cancel()
	p, err := r.resolve(ctx, user)
	ttl := r.ttl
	if err != nil && parent.Err() != nil {
		// The call itself ended, which says nothing about IAM: do not cache.
		return Principal{UserID: user, Unavailable: true}
	}
	if err != nil {
		r.log.WarnContext(ctx, "resolve caller failed; continuing without teams", "error", err)
		p, ttl = Principal{Unavailable: true}, min(failureTTL, r.ttl)
	}
	p.UserID = user
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.cache) > 10_000 { // bounded: drop everything rather than track ages
		clear(r.cache)
	}
	r.cache[user] = cached{p: p, expires: r.now().Add(ttl)}
	return p
}

// withPrincipal adds the principal of the context's user, if any.
func (r *Resolver) withPrincipal(ctx context.Context) context.Context {
	user, ok := UserFromContext(ctx)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, principalKey{}, r.Resolve(ctx, user))
}

// Principals returns the server options that make PrincipalFromContext work
// in handlers: each call that carries a user gets its principal from r. Pass
// them to New.
func Principals(r *Resolver) []grpc.ServerOption {
	return []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
			return handler(r.withPrincipal(ctx), req)
		}),
		grpc.ChainStreamInterceptor(func(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
			return handler(srv, &userServerStream{ServerStream: ss, ctx: r.withPrincipal(ss.Context())})
		}),
	}
}
