package iamclient

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

type fakeIAM struct {
	iamv1.IamServiceClient
	resp *iamv1.ResolveCallerResponse
	err  error
}

func (f fakeIAM) ResolveCaller(context.Context, *iamv1.ResolveCallerRequest, ...grpc.CallOption) (*iamv1.ResolveCallerResponse, error) {
	return f.resp, f.err
}

func TestResolveMapsTeamsAndRoles(t *testing.T) {
	resolve := Resolve(fakeIAM{resp: &iamv1.ResolveCallerResponse{
		PlatformAdmin: true,
		Teams: []*iamv1.CallerTeam{
			{TeamId: "a", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN},
			{TeamId: "b", Role: iamv1.TeamRole_TEAM_ROLE_MEMBER},
		},
	}})
	p, err := resolve(t.Context(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	want := grpcserver.Principal{UserID: "alice", PlatformAdmin: true, Teams: []grpcserver.Team{{ID: "a", Admin: true}, {ID: "b"}}}
	if p.UserID != want.UserID || p.PlatformAdmin != want.PlatformAdmin || len(p.Teams) != 2 || p.Teams[0] != want.Teams[0] || p.Teams[1] != want.Teams[1] {
		t.Errorf("principal = %+v, want %+v", p, want)
	}
}

func TestResolvePassesErrorsOn(t *testing.T) {
	boom := errors.New("down")
	if _, err := Resolve(fakeIAM{err: boom})(t.Context(), "alice"); !errors.Is(err, boom) {
		t.Errorf("error = %v, want %v", err, boom)
	}
}
