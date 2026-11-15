package server

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// errorDomain is the ErrorInfo domain of this module's errors.
const errorDomain = "knowcel.iam.v1"

// Teams are visible only to their members: a caller who is no member gets
// NOT_FOUND, as if the team did not exist. Members who lack the admin role
// for a change get PERMISSION_DENIED.

// CreateTeam creates a team with the caller as its first admin. It registers
// the caller first, so a user can create a team before anything else has
// called GetCurrentUser for them.
func (s *Server) CreateTeam(ctx context.Context, req *iamv1.CreateTeamRequest) (*iamv1.CreateTeamResponse, error) {
	name, err := validName(req.GetName())
	if err != nil {
		return nil, err
	}
	u, err := s.register(ctx)
	if err != nil {
		return nil, err
	}
	team, err := s.repo.CreateTeam(ctx, name, u.ID)
	if err != nil {
		return nil, s.internal("create team", err)
	}
	members, err := s.members(ctx, team.ID)
	if err != nil {
		return nil, err
	}
	return &iamv1.CreateTeamResponse{Team: teamMessage(team.ID, team.Name, store.RoleAdmin, members)}, nil
}

// GetTeam returns a team and its members to a member.
func (s *Server) GetTeam(ctx context.Context, req *iamv1.GetTeamRequest) (*iamv1.GetTeamResponse, error) {
	t, _, err := s.memberOf(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	members, err := s.members(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	return &iamv1.GetTeamResponse{Team: teamMessage(t.ID, t.Name, t.Role, members)}, nil
}

// ListMyTeams returns the caller's teams without their members.
func (s *Server) ListMyTeams(ctx context.Context, _ *iamv1.ListMyTeamsRequest) (*iamv1.ListMyTeamsResponse, error) {
	user, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.ListTeamsForUser(ctx, user)
	if err != nil {
		return nil, s.internal("list teams", err)
	}
	teams := make([]*iamv1.Team, 0, len(rows))
	for _, r := range rows {
		teams = append(teams, teamMessage(r.ID, r.Name, r.Role, nil))
	}
	return &iamv1.ListMyTeamsResponse{Teams: teams}, nil
}

// UpdateTeam renames a team. Team admins only.
func (s *Server) UpdateTeam(ctx context.Context, req *iamv1.UpdateTeamRequest) (*iamv1.UpdateTeamResponse, error) {
	t, err := s.adminOf(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	name, err := validName(req.GetName())
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateTeamName(ctx, store.UpdateTeamNameParams{ID: t.ID, Name: name})
	if err != nil {
		return nil, s.notFoundOr("update team", err)
	}
	members, err := s.members(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	return &iamv1.UpdateTeamResponse{Team: teamMessage(updated.ID, updated.Name, t.Role, members)}, nil
}

// DeleteTeam deletes a team and its memberships. Team admins only.
func (s *Server) DeleteTeam(ctx context.Context, req *iamv1.DeleteTeamRequest) (*iamv1.DeleteTeamResponse, error) {
	t, err := s.adminOf(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteTeam(ctx, t.ID); err != nil {
		return nil, s.internal("delete team", err)
	}
	return &iamv1.DeleteTeamResponse{}, nil
}

// AddMember adds the registered user with the given email. Team admins only.
func (s *Server) AddMember(ctx context.Context, req *iamv1.AddMemberRequest) (*iamv1.AddMemberResponse, error) {
	t, err := s.adminOf(ctx, req.GetTeamId())
	if err != nil {
		return nil, err
	}
	email := strings.TrimSpace(req.GetEmail())
	if email == "" {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("email", "An email is required"))
	}
	role := store.RoleMember
	if req.GetRole() != iamv1.TeamRole_TEAM_ROLE_UNSPECIFIED {
		if role, err = storedRole("role", req.GetRole()); err != nil {
			return nil, err
		}
	}
	u, err := s.repo.FindUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, grpcserver.WithDetails(codes.NotFound, "No registered user has this email",
			grpcserver.ErrorInfo(errorDomain, "USER_NOT_FOUND", nil))
	}
	if err != nil {
		return nil, s.internal("find user", err)
	}
	err = s.repo.InsertTeamMember(ctx, store.InsertTeamMemberParams{TeamID: t.ID, UserID: u.ID, Role: role})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation: already a member
		return nil, status.Error(codes.AlreadyExists, "The user is already a member of the team")
	}
	if err != nil {
		return nil, s.internal("add member", err)
	}
	return &iamv1.AddMemberResponse{Member: memberMessage(u.ID, u.Email, u.DisplayName, role)}, nil
}

// RemoveMember removes a member. Team admins may remove anyone, a member only
// themselves.
func (s *Server) RemoveMember(ctx context.Context, req *iamv1.RemoveMemberRequest) (*iamv1.RemoveMemberResponse, error) {
	t, user, err := s.memberOf(ctx, req.GetTeamId())
	if err != nil {
		return nil, err
	}
	if req.GetUserId() != user && t.Role != store.RoleAdmin {
		return nil, errNeedsAdmin
	}
	if err := s.repo.RemoveMember(ctx, t.ID, req.GetUserId()); err != nil {
		return nil, s.memberError("remove member", err)
	}
	return &iamv1.RemoveMemberResponse{}, nil
}

// SetMemberRole changes a member's role. Team admins only.
func (s *Server) SetMemberRole(ctx context.Context, req *iamv1.SetMemberRoleRequest) (*iamv1.SetMemberRoleResponse, error) {
	t, err := s.adminOf(ctx, req.GetTeamId())
	if err != nil {
		return nil, err
	}
	role, err := storedRole("role", req.GetRole())
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetMemberRole(ctx, t.ID, req.GetUserId(), role); err != nil {
		return nil, s.memberError("set member role", err)
	}
	m, err := s.repo.GetTeamMember(ctx, store.GetTeamMemberParams{TeamID: t.ID, UserID: req.GetUserId()})
	if err != nil {
		return nil, s.notFoundOr("get member", err)
	}
	return &iamv1.SetMemberRoleResponse{Member: memberMessage(m.UserID, m.Email, m.DisplayName, m.Role)}, nil
}

var errNeedsAdmin = status.Error(codes.PermissionDenied, "Only team admins can do this")

// memberOf returns the team with the caller's role, or NOT_FOUND when the
// caller is no member (or the id is no team).
func (s *Server) memberOf(ctx context.Context, rawID string) (store.GetTeamForUserRow, string, error) {
	user, err := caller(ctx)
	if err != nil {
		return store.GetTeamForUserRow{}, "", err
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		// An id that is no uuid names no team; answer like a stranger would get.
		return store.GetTeamForUserRow{}, "", errTeamNotFound
	}
	t, err := s.repo.GetTeamForUser(ctx, store.GetTeamForUserParams{ID: id, UserID: user})
	if err != nil {
		return store.GetTeamForUserRow{}, "", s.notFoundOr("get team", err)
	}
	return t, user, nil
}

// adminOf is memberOf for changes that need the admin role.
func (s *Server) adminOf(ctx context.Context, rawID string) (store.GetTeamForUserRow, error) {
	t, _, err := s.memberOf(ctx, rawID)
	if err != nil {
		return t, err
	}
	if t.Role != store.RoleAdmin {
		return t, errNeedsAdmin
	}
	return t, nil
}

var errTeamNotFound = status.Error(codes.NotFound, "team not found")

func (s *Server) notFoundOr(op string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return errTeamNotFound
	}
	return s.internal(op, err)
}

// memberError maps the repository's membership errors.
func (s *Server) memberError(op string, err error) error {
	switch {
	case errors.Is(err, store.ErrNotMember):
		return status.Error(codes.NotFound, "member not found")
	case errors.Is(err, store.ErrLastAdmin):
		return grpcserver.WithDetails(codes.FailedPrecondition, "A team needs at least one admin",
			grpcserver.ErrorInfo(errorDomain, "LAST_ADMIN", nil))
	}
	return s.internal(op, err)
}

func (s *Server) members(ctx context.Context, teamID uuid.UUID) ([]*iamv1.TeamMember, error) {
	rows, err := s.repo.ListTeamMembers(ctx, teamID)
	if err != nil {
		return nil, s.internal("list members", err)
	}
	members := make([]*iamv1.TeamMember, 0, len(rows))
	for _, r := range rows {
		members = append(members, memberMessage(r.UserID, r.Email, r.DisplayName, r.Role))
	}
	return members, nil
}

func validName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch {
	case name == "":
		return "", grpcserver.InvalidArgument(grpcserver.Violation("name", "A name is required"))
	case utf8.RuneCountInString(name) > maxTeamNameRunes:
		return "", grpcserver.InvalidArgument(grpcserver.Violation("name", "The name is too long"))
	}
	return name, nil
}

// storedRole converts a request's role to its stored value.
func storedRole(field string, r iamv1.TeamRole) (int16, error) {
	switch r {
	case iamv1.TeamRole_TEAM_ROLE_ADMIN:
		return store.RoleAdmin, nil
	case iamv1.TeamRole_TEAM_ROLE_MEMBER:
		return store.RoleMember, nil
	}
	return 0, grpcserver.InvalidArgument(grpcserver.Violation(field, "The role must be admin or member"))
}

func teamMessage(id uuid.UUID, name string, role int16, members []*iamv1.TeamMember) *iamv1.Team {
	return &iamv1.Team{Id: id.String(), Name: name, MyRole: iamv1.TeamRole(role), Members: members}
}

func memberMessage(userID, email, displayName string, role int16) *iamv1.TeamMember {
	return &iamv1.TeamMember{UserId: userID, Email: email, DisplayName: displayName, Role: iamv1.TeamRole(role)}
}
