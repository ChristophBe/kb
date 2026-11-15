package server

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// memRepo is an in-memory Repository. The last-admin rule is enforced by the
// store's Repo against Postgres and tested there; here it only has to answer
// the way the Repo does.
type memRepo struct {
	users   map[string]store.IamUser
	teams   map[uuid.UUID]store.IamTeam
	members map[uuid.UUID][]store.InsertTeamMemberParams
}

func newMemRepo() *memRepo {
	return &memRepo{
		users:   map[string]store.IamUser{},
		teams:   map[uuid.UUID]store.IamTeam{},
		members: map[uuid.UUID][]store.InsertTeamMemberParams{},
	}
}

func (m *memRepo) UpsertUser(_ context.Context, a store.UpsertUserParams) (store.IamUser, error) {
	u, ok := m.users[a.ID]
	if !ok {
		u = store.IamUser{ID: a.ID, PlatformAdmin: a.PlatformAdmin}
	}
	if a.Email != "" {
		u.Email = a.Email
	}
	if a.DisplayName != "" {
		u.DisplayName = a.DisplayName
	}
	m.users[a.ID] = u
	return u, nil
}

func (m *memRepo) FindUserByEmail(_ context.Context, email string) (store.IamUser, error) {
	for _, u := range m.users {
		if strings.EqualFold(u.Email, email) {
			return u, nil
		}
	}
	return store.IamUser{}, pgx.ErrNoRows
}

func (m *memRepo) GetUser(_ context.Context, id string) (store.IamUser, error) {
	if u, ok := m.users[id]; ok {
		return u, nil
	}
	return store.IamUser{}, pgx.ErrNoRows
}

func (m *memRepo) CreateTeam(_ context.Context, name, creator string) (store.IamTeam, error) {
	t := store.IamTeam{ID: uuid.New(), Name: name}
	m.teams[t.ID] = t
	m.members[t.ID] = []store.InsertTeamMemberParams{{TeamID: t.ID, UserID: creator, Role: store.RoleAdmin}}
	return t, nil
}

func (m *memRepo) UpdateTeamName(_ context.Context, a store.UpdateTeamNameParams) (store.IamTeam, error) {
	t, ok := m.teams[a.ID]
	if !ok {
		return t, pgx.ErrNoRows
	}
	t.Name = a.Name
	m.teams[a.ID] = t
	return t, nil
}

func (m *memRepo) DeleteTeam(_ context.Context, id uuid.UUID) error {
	delete(m.teams, id)
	delete(m.members, id)
	return nil
}

func (m *memRepo) role(team uuid.UUID, user string) (int16, bool) {
	for _, mem := range m.members[team] {
		if mem.UserID == user {
			return mem.Role, true
		}
	}
	return 0, false
}

func (m *memRepo) GetTeamForUser(_ context.Context, a store.GetTeamForUserParams) (store.GetTeamForUserRow, error) {
	role, ok := m.role(a.ID, a.UserID)
	if !ok {
		return store.GetTeamForUserRow{}, pgx.ErrNoRows
	}
	return store.GetTeamForUserRow{ID: a.ID, Name: m.teams[a.ID].Name, Role: role}, nil
}

func (m *memRepo) ListTeamsForUser(_ context.Context, user string) ([]store.ListTeamsForUserRow, error) {
	rows := []store.ListTeamsForUserRow{}
	for id, t := range m.teams {
		if role, ok := m.role(id, user); ok {
			rows = append(rows, store.ListTeamsForUserRow{ID: id, Name: t.Name, Role: role})
		}
	}
	return rows, nil
}

func (m *memRepo) ListTeamMembers(_ context.Context, team uuid.UUID) ([]store.ListTeamMembersRow, error) {
	rows := []store.ListTeamMembersRow{}
	for _, mem := range m.members[team] {
		u := m.users[mem.UserID]
		rows = append(rows, store.ListTeamMembersRow{UserID: mem.UserID, Email: u.Email, DisplayName: u.DisplayName, Role: mem.Role})
	}
	return rows, nil
}

func (m *memRepo) GetTeamMember(_ context.Context, a store.GetTeamMemberParams) (store.GetTeamMemberRow, error) {
	role, ok := m.role(a.TeamID, a.UserID)
	if !ok {
		return store.GetTeamMemberRow{}, pgx.ErrNoRows
	}
	u := m.users[a.UserID]
	return store.GetTeamMemberRow{UserID: a.UserID, Email: u.Email, DisplayName: u.DisplayName, Role: role}, nil
}

func (m *memRepo) InsertTeamMember(_ context.Context, a store.InsertTeamMemberParams) error {
	if _, ok := m.role(a.TeamID, a.UserID); ok {
		return &pgconn.PgError{Code: "23505"}
	}
	m.members[a.TeamID] = append(m.members[a.TeamID], a)
	return nil
}

func (m *memRepo) admins(team uuid.UUID) int {
	n := 0
	for _, mem := range m.members[team] {
		if mem.Role == store.RoleAdmin {
			n++
		}
	}
	return n
}

func (m *memRepo) RemoveMember(_ context.Context, team uuid.UUID, user string) error {
	role, ok := m.role(team, user)
	if !ok {
		return store.ErrNotMember
	}
	if role == store.RoleAdmin && m.admins(team) == 1 {
		return store.ErrLastAdmin
	}
	m.members[team] = slices.DeleteFunc(m.members[team], func(mem store.InsertTeamMemberParams) bool { return mem.UserID == user })
	return nil
}

func (m *memRepo) SetMemberRole(_ context.Context, team uuid.UUID, user string, role int16) error {
	cur, ok := m.role(team, user)
	if !ok {
		return store.ErrNotMember
	}
	if cur == store.RoleAdmin && role != store.RoleAdmin && m.admins(team) == 1 {
		return store.ErrLastAdmin
	}
	for i := range m.members[team] {
		if m.members[team][i].UserID == user {
			m.members[team][i].Role = role
		}
	}
	return nil
}

// world is a server over a memRepo with three registered users.
type world struct {
	t   *testing.T
	srv *Server
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, srv: newServer(newMemRepo())}
	for _, u := range []string{"ann", "bob", "cy"} {
		if _, err := w.srv.GetCurrentUser(w.as(u), &iamv1.GetCurrentUserRequest{}); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// as is the context of a call for user, whose email is user@example.com.
func (w *world) as(user string) context.Context {
	md := metadata.Pairs(emailHeader, user+"@example.com", nameHeader, strings.ToUpper(user[:1])+user[1:])
	return grpcserver.WithUser(metadata.NewIncomingContext(w.t.Context(), md), user)
}

// team creates a team as ann with bob (member) in it.
func (w *world) team() string {
	w.t.Helper()
	created, err := w.srv.CreateTeam(w.as("ann"), &iamv1.CreateTeamRequest{Name: "Platform"})
	if err != nil {
		w.t.Fatal(err)
	}
	id := created.GetTeam().GetId()
	if _, err := w.srv.AddMember(w.as("ann"), &iamv1.AddMemberRequest{TeamId: id, Email: "bob@example.com"}); err != nil {
		w.t.Fatal(err)
	}
	return id
}

func wantCode(t *testing.T, what string, err error, want codes.Code) {
	t.Helper()
	if got := status.Code(err); got != want {
		t.Errorf("%s: code = %v (%v), want %v", what, got, err, want)
	}
}

func TestCreateTeamMakesTheCallerAdminAndRegistersThem(t *testing.T) {
	srv := newServer(newMemRepo())
	ctx := asUser(t, "ann", "ann@example.com", "Ann")
	resp, err := srv.CreateTeam(ctx, &iamv1.CreateTeamRequest{Name: "  Platform "})
	if err != nil {
		t.Fatal(err)
	}
	team := resp.GetTeam()
	if team.GetName() != "Platform" || team.GetMyRole() != iamv1.TeamRole_TEAM_ROLE_ADMIN {
		t.Errorf("team = %v", team)
	}
	if m := team.GetMembers(); len(m) != 1 || m[0].GetUserId() != "ann" || m[0].GetEmail() != "ann@example.com" {
		t.Errorf("members = %v", m)
	}
}

func TestTeamNamesAreValidated(t *testing.T) {
	w := newWorld(t)
	for _, name := range []string{"", "   ", strings.Repeat("x", maxTeamNameRunes+1)} {
		_, err := w.srv.CreateTeam(w.as("ann"), &iamv1.CreateTeamRequest{Name: name})
		wantCode(t, "create "+name, err, codes.InvalidArgument)
	}
	id := w.team()
	_, err := w.srv.UpdateTeam(w.as("ann"), &iamv1.UpdateTeamRequest{Id: id, Name: " "})
	wantCode(t, "rename", err, codes.InvalidArgument)
}

func TestCallsNeedAUser(t *testing.T) {
	srv := newServer(newMemRepo())
	_, err := srv.CreateTeam(t.Context(), &iamv1.CreateTeamRequest{Name: "x"})
	wantCode(t, "create", err, codes.Unauthenticated)
	_, err = srv.ListMyTeams(t.Context(), &iamv1.ListMyTeamsRequest{})
	wantCode(t, "list", err, codes.Unauthenticated)
	_, err = srv.GetTeam(t.Context(), &iamv1.GetTeamRequest{Id: uuid.NewString()})
	wantCode(t, "get", err, codes.Unauthenticated)
}

func TestNonMembersGetNotFound(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	cy := w.as("cy")
	for name, call := range map[string]func() error{
		"get":    func() error { _, err := w.srv.GetTeam(cy, &iamv1.GetTeamRequest{Id: id}); return err },
		"update": func() error { _, err := w.srv.UpdateTeam(cy, &iamv1.UpdateTeamRequest{Id: id, Name: "x"}); return err },
		"delete": func() error { _, err := w.srv.DeleteTeam(cy, &iamv1.DeleteTeamRequest{Id: id}); return err },
		"add": func() error {
			_, err := w.srv.AddMember(cy, &iamv1.AddMemberRequest{TeamId: id, Email: "bob@example.com"})
			return err
		},
		"remove": func() error {
			_, err := w.srv.RemoveMember(cy, &iamv1.RemoveMemberRequest{TeamId: id, UserId: "bob"})
			return err
		},
		"set role": func() error {
			_, err := w.srv.SetMemberRole(cy, &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "bob", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN})
			return err
		},
		"bad id":  func() error { _, err := w.srv.GetTeam(cy, &iamv1.GetTeamRequest{Id: "nope"}); return err },
		"unknown": func() error { _, err := w.srv.GetTeam(cy, &iamv1.GetTeamRequest{Id: uuid.NewString()}); return err },
	} {
		wantCode(t, name, call(), codes.NotFound)
	}
	list, err := w.srv.ListMyTeams(cy, &iamv1.ListMyTeamsRequest{})
	if err != nil || len(list.GetTeams()) != 0 {
		t.Errorf("list = %v, %v", list, err)
	}
}

func TestMembersCannotAdminister(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	bob := w.as("bob")
	if got, err := w.srv.GetTeam(bob, &iamv1.GetTeamRequest{Id: id}); err != nil || len(got.GetTeam().GetMembers()) != 2 || got.GetTeam().GetMyRole() != iamv1.TeamRole_TEAM_ROLE_MEMBER {
		t.Errorf("a member reads the team: %v, %v", got, err)
	}
	for name, call := range map[string]func() error{
		"update": func() error { _, err := w.srv.UpdateTeam(bob, &iamv1.UpdateTeamRequest{Id: id, Name: "x"}); return err },
		"delete": func() error { _, err := w.srv.DeleteTeam(bob, &iamv1.DeleteTeamRequest{Id: id}); return err },
		"add": func() error {
			_, err := w.srv.AddMember(bob, &iamv1.AddMemberRequest{TeamId: id, Email: "cy@example.com"})
			return err
		},
		"remove others": func() error {
			_, err := w.srv.RemoveMember(bob, &iamv1.RemoveMemberRequest{TeamId: id, UserId: "ann"})
			return err
		},
		"set role": func() error {
			_, err := w.srv.SetMemberRole(bob, &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "bob", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN})
			return err
		},
	} {
		wantCode(t, name, call(), codes.PermissionDenied)
	}
}

func TestAMemberCanLeave(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	if _, err := w.srv.RemoveMember(w.as("bob"), &iamv1.RemoveMemberRequest{TeamId: id, UserId: "bob"}); err != nil {
		t.Fatal(err)
	}
	_, err := w.srv.GetTeam(w.as("bob"), &iamv1.GetTeamRequest{Id: id})
	wantCode(t, "get after leaving", err, codes.NotFound)
}

func TestAdminsManageMembers(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	ann := w.as("ann")
	added, err := w.srv.AddMember(ann, &iamv1.AddMemberRequest{TeamId: id, Email: "CY@Example.com", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN})
	if err != nil {
		t.Fatal(err)
	}
	if m := added.GetMember(); m.GetUserId() != "cy" || m.GetRole() != iamv1.TeamRole_TEAM_ROLE_ADMIN || m.GetDisplayName() != "Cy" {
		t.Errorf("member = %v", m)
	}
	promoted, err := w.srv.SetMemberRole(ann, &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "bob", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN})
	if err != nil || promoted.GetMember().GetRole() != iamv1.TeamRole_TEAM_ROLE_ADMIN {
		t.Fatalf("promote: %v, %v", promoted, err)
	}
	if _, err := w.srv.RemoveMember(ann, &iamv1.RemoveMemberRequest{TeamId: id, UserId: "cy"}); err != nil {
		t.Fatal(err)
	}
	renamed, err := w.srv.UpdateTeam(ann, &iamv1.UpdateTeamRequest{Id: id, Name: "Ops"})
	if err != nil || renamed.GetTeam().GetName() != "Ops" || len(renamed.GetTeam().GetMembers()) != 2 {
		t.Fatalf("rename: %v, %v", renamed, err)
	}
	if _, err := w.srv.DeleteTeam(ann, &iamv1.DeleteTeamRequest{Id: id}); err != nil {
		t.Fatal(err)
	}
	_, err = w.srv.GetTeam(w.as("bob"), &iamv1.GetTeamRequest{Id: id})
	wantCode(t, "get after delete", err, codes.NotFound)
}

func TestAddMemberErrors(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	ann := w.as("ann")
	_, err := w.srv.AddMember(ann, &iamv1.AddMemberRequest{TeamId: id, Email: "nobody@example.com"})
	wantCode(t, "unknown email", err, codes.NotFound)
	_, err = w.srv.AddMember(ann, &iamv1.AddMemberRequest{TeamId: id, Email: "bob@example.com"})
	wantCode(t, "already a member", err, codes.AlreadyExists)
	_, err = w.srv.AddMember(ann, &iamv1.AddMemberRequest{TeamId: id, Email: " "})
	wantCode(t, "no email", err, codes.InvalidArgument)
	_, err = w.srv.AddMember(ann, &iamv1.AddMemberRequest{TeamId: id, Email: "cy@example.com", Role: 9})
	wantCode(t, "bad role", err, codes.InvalidArgument)
}

func TestTheLastAdminStays(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	ann := w.as("ann")
	_, err := w.srv.RemoveMember(ann, &iamv1.RemoveMemberRequest{TeamId: id, UserId: "ann"})
	wantCode(t, "leave", err, codes.FailedPrecondition)
	_, err = w.srv.SetMemberRole(ann, &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "ann", Role: iamv1.TeamRole_TEAM_ROLE_MEMBER})
	wantCode(t, "demote", err, codes.FailedPrecondition)

	// With a second admin, the first may leave.
	if _, err := w.srv.SetMemberRole(ann, &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "bob", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.srv.RemoveMember(ann, &iamv1.RemoveMemberRequest{TeamId: id, UserId: "ann"}); err != nil {
		t.Errorf("leave with a second admin: %v", err)
	}
	_, err = w.srv.SetMemberRole(w.as("bob"), &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "bob", Role: iamv1.TeamRole_TEAM_ROLE_UNSPECIFIED})
	wantCode(t, "unspecified role", err, codes.InvalidArgument)
}

func TestUnknownMembersAreNotFound(t *testing.T) {
	w := newWorld(t)
	id := w.team()
	_, err := w.srv.RemoveMember(w.as("ann"), &iamv1.RemoveMemberRequest{TeamId: id, UserId: "cy"})
	wantCode(t, "remove", err, codes.NotFound)
	_, err = w.srv.SetMemberRole(w.as("ann"), &iamv1.SetMemberRoleRequest{TeamId: id, UserId: "cy", Role: iamv1.TeamRole_TEAM_ROLE_ADMIN})
	wantCode(t, "set role", err, codes.NotFound)
}

func TestListMyTeamsHasTheCallersRoles(t *testing.T) {
	w := newWorld(t)
	w.team()
	if _, err := w.srv.CreateTeam(w.as("bob"), &iamv1.CreateTeamRequest{Name: "Bob's"}); err != nil {
		t.Fatal(err)
	}
	list, err := w.srv.ListMyTeams(w.as("bob"), &iamv1.ListMyTeamsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	roles := map[string]iamv1.TeamRole{}
	for _, tm := range list.GetTeams() {
		roles[tm.GetName()] = tm.GetMyRole()
		if len(tm.GetMembers()) != 0 {
			t.Errorf("%s lists members", tm.GetName())
		}
	}
	if len(roles) != 2 || roles["Platform"] != iamv1.TeamRole_TEAM_ROLE_MEMBER || roles["Bob's"] != iamv1.TeamRole_TEAM_ROLE_ADMIN {
		t.Errorf("roles = %v", roles)
	}
}
