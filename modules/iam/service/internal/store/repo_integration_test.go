//go:build integration

package store

import (
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/ChristophBe/knowcelium/modules/iam/migrations"
	"github.com/ChristophBe/knowcelium/platform/go/postgres/pgtest"
)

func newRepo(t *testing.T) *Repo {
	t.Helper()
	return NewRepo(pgtest.Start(t, "iam", migrations.FS))
}

func register(t *testing.T, r *Repo, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if _, err := r.UpsertUser(t.Context(), UpsertUserParams{ID: id, Email: id + "@Example.com"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCreateTeamMakesTheCreatorAdmin(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann")
	team, err := r.CreateTeam(ctx, "Platform", "ann")
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.GetTeamForUser(ctx, GetTeamForUserParams{ID: team.ID, UserID: "ann"})
	if err != nil || got.Role != RoleAdmin || got.Name != "Platform" {
		t.Fatalf("got = %+v, %v", got, err)
	}
	teams, err := r.ListTeamsForUser(ctx, "ann")
	if err != nil || len(teams) != 1 {
		t.Fatalf("teams = %+v, %v", teams, err)
	}
}

func TestGetUser(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann")
	if u, err := r.GetUser(ctx, "ann"); err != nil || u.ID != "ann" {
		t.Fatalf("GetUser(ann) = %+v, %v", u, err)
	}
	if _, err := r.GetUser(ctx, "nobody"); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("GetUser(nobody) error = %v, want pgx.ErrNoRows", err)
	}
}

func TestCreateTeamOfAnUnregisteredUserLeavesNothing(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	if _, err := r.CreateTeam(ctx, "Ghosts", "nobody"); err == nil {
		t.Fatal("created a team for an unregistered user")
	}
	var n int
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM iam.teams").Scan(&n); err != nil || n != 0 {
		t.Errorf("teams = %d, %v", n, err)
	}
}

func TestFindUserByEmailIgnoresCaseAndBlanks(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann")
	if _, err := r.UpsertUser(ctx, UpsertUserParams{ID: "noemail"}); err != nil {
		t.Fatal(err)
	}
	u, err := r.FindUserByEmail(ctx, "ANN@example.COM")
	if err != nil || u.ID != "ann" {
		t.Errorf("u = %+v, %v", u, err)
	}
	if _, err := r.FindUserByEmail(ctx, ""); err == nil {
		t.Error("a blank email matched a user")
	}
}

func TestTheLastAdminCannotLeaveOrBeDemoted(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann", "bob")
	team, _ := r.CreateTeam(ctx, "Platform", "ann")
	if err := r.InsertTeamMember(ctx, InsertTeamMemberParams{TeamID: team.ID, UserID: "bob", Role: RoleMember}); err != nil {
		t.Fatal(err)
	}
	if err := r.RemoveMember(ctx, team.ID, "ann"); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("leave: %v", err)
	}
	if err := r.SetMemberRole(ctx, team.ID, "ann", RoleMember); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("demote: %v", err)
	}
	// A member may be removed or re-roled freely; a second admin frees the first.
	if err := r.SetMemberRole(ctx, team.ID, "bob", RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := r.RemoveMember(ctx, team.ID, "ann"); err != nil {
		t.Errorf("leave with a second admin: %v", err)
	}
	if err := r.RemoveMember(ctx, team.ID, "ann"); !errors.Is(err, ErrNotMember) {
		t.Errorf("leave twice: %v", err)
	}
	if err := r.SetMemberRole(ctx, team.ID, "ann", RoleAdmin); !errors.Is(err, ErrNotMember) {
		t.Errorf("set role of a non-member: %v", err)
	}
}

func TestTwoAdminsCannotDemoteEachOtherAtOnce(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann", "bob")
	team, _ := r.CreateTeam(ctx, "Platform", "ann")
	if err := r.InsertTeamMember(ctx, InsertTeamMemberParams{TeamID: team.ID, UserID: "bob", Role: RoleAdmin}); err != nil {
		t.Fatal(err)
	}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, user := range []string{"ann", "bob"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = r.SetMemberRole(ctx, team.ID, user, RoleMember)
		}()
	}
	wg.Wait()
	if (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("exactly one demotion must succeed, got %v and %v", errs[0], errs[1])
	}
	var admins int
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM iam.team_members WHERE team_id = $1 AND role = $2", team.ID, RoleAdmin).Scan(&admins); err != nil || admins != 1 {
		t.Errorf("admins = %d, %v", admins, err)
	}
}

func TestDeletingATeamRemovesItsMemberships(t *testing.T) {
	r, ctx := newRepo(t), t.Context()
	register(t, r, "ann")
	team, _ := r.CreateTeam(ctx, "Platform", "ann")
	if err := r.DeleteTeam(ctx, team.ID); err != nil {
		t.Fatal(err)
	}
	if teams, err := r.ListTeamsForUser(ctx, "ann"); err != nil || len(teams) != 0 {
		t.Errorf("teams = %+v, %v", teams, err)
	}
	if err := r.RemoveMember(ctx, team.ID, "ann"); !errors.Is(err, ErrNotMember) {
		t.Errorf("remove from a deleted team: %v", err)
	}
}
