package server

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
)

// ResolveCaller returns the caller's platform-admin flag and team roles. A
// user who is not registered yet has neither.
func (s *Server) ResolveCaller(ctx context.Context, _ *iamv1.ResolveCallerRequest) (*iamv1.ResolveCallerResponse, error) {
	id, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	resp := &iamv1.ResolveCallerResponse{UserId: id}
	u, err := s.repo.GetUser(ctx, id)
	switch {
	case err == nil:
		resp.PlatformAdmin = u.PlatformAdmin
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, s.internal("get user", err)
	}
	rows, err := s.repo.ListTeamsForUser(ctx, id)
	if err != nil {
		return nil, s.internal("list teams", err)
	}
	for _, r := range rows {
		resp.Teams = append(resp.Teams, &iamv1.CallerTeam{TeamId: r.ID.String(), Role: iamv1.TeamRole(r.Role)})
	}
	return resp, nil
}
