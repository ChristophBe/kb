package server

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

type callerRepo struct {
	Repository
	user    store.IamUser
	userErr error
	teams   []store.ListTeamsForUserRow
}

func (r *callerRepo) GetUser(context.Context, string) (store.IamUser, error) {
	return r.user, r.userErr
}

func (r *callerRepo) ListTeamsForUser(context.Context, string) ([]store.ListTeamsForUserRow, error) {
	return r.teams, nil
}

func TestResolveCallerReturnsTeamsAndAdminFlag(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	repo := &callerRepo{
		user:  store.IamUser{ID: "ann", PlatformAdmin: true},
		teams: []store.ListTeamsForUserRow{{ID: a, Role: store.RoleAdmin}, {ID: b, Role: store.RoleMember}},
	}
	resp, err := newServer(repo).ResolveCaller(grpcserver.WithUser(t.Context(), "ann"), &iamv1.ResolveCallerRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.GetUserId() != "ann" || !resp.GetPlatformAdmin() || len(resp.GetTeams()) != 2 {
		t.Fatalf("resp = %v", resp)
	}
	if got := resp.GetTeams()[0]; got.GetTeamId() != a.String() || got.GetRole() != iamv1.TeamRole_TEAM_ROLE_ADMIN {
		t.Errorf("team 0 = %v", got)
	}
	if got := resp.GetTeams()[1]; got.GetTeamId() != b.String() || got.GetRole() != iamv1.TeamRole_TEAM_ROLE_MEMBER {
		t.Errorf("team 1 = %v", got)
	}
}

func TestResolveCallerOfAnUnregisteredUserHasNoRights(t *testing.T) {
	repo := &callerRepo{userErr: pgx.ErrNoRows}
	resp, err := newServer(repo).ResolveCaller(grpcserver.WithUser(t.Context(), "new"), &iamv1.ResolveCallerRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.GetUserId() != "new" || resp.GetPlatformAdmin() || len(resp.GetTeams()) != 0 {
		t.Errorf("resp = %v", resp)
	}
}

func TestResolveCallerNeedsAUser(t *testing.T) {
	_, err := newServer(&callerRepo{}).ResolveCaller(t.Context(), &iamv1.ResolveCallerRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("code = %v, want Unauthenticated", status.Code(err))
	}
}

func TestResolveCallerStoreFailureIsInternal(t *testing.T) {
	repo := &callerRepo{userErr: errors.New("db down")}
	_, err := newServer(repo).ResolveCaller(grpcserver.WithUser(t.Context(), "ann"), &iamv1.ResolveCallerRequest{})
	if status.Code(err) != codes.Internal {
		t.Errorf("code = %v, want Internal", status.Code(err))
	}
}
