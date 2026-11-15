// Package server implements knowcel.iam.v1.IamService.
package server

import (
	"context"
	"log/slog"
	"strings"

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
}

// Server implements IamService.
type Server struct {
	iamv1.UnimplementedIamServiceServer
	repo           Repository
	bootstrapAdmins []string
	log            *slog.Logger
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
	id, ok := grpcserver.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "the call has no user")
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
		s.log.ErrorContext(ctx, "register user failed", "error", err)
		return nil, status.Error(codes.Internal, "get current user failed")
	}
	return &iamv1.GetCurrentUserResponse{User: &iamv1.User{
		Id:            u.ID,
		Email:         u.Email,
		DisplayName:   u.DisplayName,
		PlatformAdmin: u.PlatformAdmin,
	}}, nil
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
