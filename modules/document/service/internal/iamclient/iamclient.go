// Package iamclient looks up callers through the iam module.
package iamclient

import (
	"context"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// Resolve returns the lookup grpcserver.NewResolver caches: the teams and
// platform-admin flag of the user whose call is being served. The context
// carries that user, so a client made with grpcserver.Dial passes them on.
func Resolve(c iamv1.IamServiceClient) grpcserver.ResolveFunc {
	return func(ctx context.Context, user string) (grpcserver.Principal, error) {
		resp, err := c.ResolveCaller(ctx, &iamv1.ResolveCallerRequest{})
		if err != nil {
			return grpcserver.Principal{}, err
		}
		p := grpcserver.Principal{UserID: user, PlatformAdmin: resp.GetPlatformAdmin()}
		for _, t := range resp.GetTeams() {
			p.Teams = append(p.Teams, grpcserver.Team{ID: t.GetTeamId(), Admin: t.GetRole() == iamv1.TeamRole_TEAM_ROLE_ADMIN})
		}
		return p, nil
	}
}
