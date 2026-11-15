// Package server implements knowcel.iam.v1.IamService.
package server

import (
	"context"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// Envoy sets these next to x-kb-user from the claims of the verified token,
// and drops any value the client sent (tools/modgen/templates/envoy.yaml.tmpl).
const (
	emailHeader = "x-kb-email"
	nameHeader  = "x-kb-name"
)

// Repository is the persistence the server needs.
type Repository interface {
	UpsertUser(ctx context.Context, arg store.UpsertUserParams) (store.IamUser, error)
	FindUserByEmail(ctx context.Context, email string) (store.IamUser, error)
	GetUser(ctx context.Context, id string) (store.IamUser, error)
	ListUsers(ctx context.Context) ([]store.IamUser, error)
	// SetPlatformAdmin fails with store.ErrLastPlatformAdmin or pgx.ErrNoRows.
	SetPlatformAdmin(ctx context.Context, id string, admin bool) (store.IamUser, error)

	CreateTeam(ctx context.Context, name, creator string) (store.IamTeam, error)
	UpdateTeamName(ctx context.Context, arg store.UpdateTeamNameParams) (store.IamTeam, error)
	DeleteTeam(ctx context.Context, id uuid.UUID) error
	GetTeamForUser(ctx context.Context, arg store.GetTeamForUserParams) (store.GetTeamForUserRow, error)
	ListTeamsForUser(ctx context.Context, userID string) ([]store.ListTeamsForUserRow, error)

	ListTeamMembers(ctx context.Context, teamID uuid.UUID) ([]store.ListTeamMembersRow, error)
	GetTeamMember(ctx context.Context, arg store.GetTeamMemberParams) (store.GetTeamMemberRow, error)
	InsertTeamMember(ctx context.Context, arg store.InsertTeamMemberParams) error
	// RemoveMember and SetMemberRole fail with store.ErrNotMember or
	// store.ErrLastAdmin.
	RemoveMember(ctx context.Context, teamID uuid.UUID, userID string) error
	SetMemberRole(ctx context.Context, teamID uuid.UUID, userID string, role int16) error
}

// maxTeamNameRunes bounds a team name.
const maxTeamNameRunes = 100

// Server implements IamService.
type Server struct {
	iamv1.UnimplementedIamServiceServer
	repo            Repository
	bootstrapAdmins []string
	log             *slog.Logger
}

// New builds the server. bootstrapAdmins are the subjects or emails of the
// users who become platform admins when they are first seen.
func New(repo Repository, bootstrapAdmins []string, log *slog.Logger) *Server {
	var admins []string
	for _, a := range bootstrapAdmins {
		if a = strings.TrimSpace(a); a != "" {
			admins = append(admins, a)
		}
	}
	return &Server{repo: repo, bootstrapAdmins: admins, log: log}
}

// GetCurrentUser registers the caller on their first call and refreshes their
// email and display name on later ones.
func (s *Server) GetCurrentUser(ctx context.Context, _ *iamv1.GetCurrentUserRequest) (*iamv1.GetCurrentUserResponse, error) {
	u, err := s.register(ctx)
	if err != nil {
		return nil, err
	}
	return &iamv1.GetCurrentUserResponse{User: userMessage(u)}, nil
}

// register upserts the caller from the token's claims.
func (s *Server) register(ctx context.Context) (store.IamUser, error) {
	id, err := caller(ctx)
	if err != nil {
		return store.IamUser{}, err
	}
	md, _ := metadata.FromIncomingContext(ctx)
	email, name := first(md, emailHeader), first(md, nameHeader)
	u, err := s.repo.UpsertUser(ctx, store.UpsertUserParams{
		ID:            id,
		Email:         email,
		DisplayName:   name,
		PlatformAdmin: s.isBootstrapAdmin(id, email),
	})
	if err != nil {
		return store.IamUser{}, s.internal("register user", err)
	}
	return u, nil
}

// isBootstrapAdmin reports whether the subject, or a non-empty email
// (case-insensitively), is configured as a platform admin.
func (s *Server) isBootstrapAdmin(id, email string) bool {
	for _, a := range s.bootstrapAdmins {
		if a == id || (email != "" && strings.EqualFold(a, email)) {
			return true
		}
	}
	return false
}

func first(md metadata.MD, key string) string {
	if v := md.Get(key); len(v) > 0 {
		return v[0]
	}
	return ""
}

func caller(ctx context.Context) (string, error) {
	id, ok := grpcserver.UserFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "the call has no user")
	}
	return id, nil
}

func (s *Server) internal(op string, err error) error {
	s.log.Error(op+" failed", "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}
