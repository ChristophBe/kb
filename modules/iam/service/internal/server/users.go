package server

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

var errNeedsPlatformAdmin = status.Error(codes.PermissionDenied, "Only platform admins can do this")

// ListUsers returns the user directory. Platform admins only.
func (s *Server) ListUsers(ctx context.Context, _ *iamv1.ListUsersRequest) (*iamv1.ListUsersResponse, error) {
	if err := s.requirePlatformAdmin(ctx); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListUsers(ctx)
	if err != nil {
		return nil, s.internal("list users", err)
	}
	users := make([]*iamv1.User, 0, len(rows))
	for _, u := range rows {
		users = append(users, userMessage(u))
	}
	return &iamv1.ListUsersResponse{Users: users}, nil
}

// SetPlatformAdmin promotes or demotes a user. Platform admins only; the last
// platform admin stays.
func (s *Server) SetPlatformAdmin(ctx context.Context, req *iamv1.SetPlatformAdminRequest) (*iamv1.SetPlatformAdminResponse, error) {
	if err := s.requirePlatformAdmin(ctx); err != nil {
		return nil, err
	}
	if req.GetUserId() == "" {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("user_id", "A user is required"))
	}
	u, err := s.repo.SetPlatformAdmin(ctx, req.GetUserId(), req.GetPlatformAdmin())
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, status.Error(codes.NotFound, "user not found")
	case errors.Is(err, store.ErrLastPlatformAdmin):
		return nil, grpcserver.WithDetails(codes.FailedPrecondition, "The platform needs at least one admin",
			grpcserver.ErrorInfo(errorDomain, "LAST_PLATFORM_ADMIN", nil))
	case err != nil:
		return nil, s.internal("set platform admin", err)
	}
	return &iamv1.SetPlatformAdminResponse{User: userMessage(u)}, nil
}

// requirePlatformAdmin fails with PERMISSION_DENIED unless the caller is a
// registered platform admin.
func (s *Server) requirePlatformAdmin(ctx context.Context) error {
	id, err := caller(ctx)
	if err != nil {
		return err
	}
	u, err := s.repo.GetUser(ctx, id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return errNeedsPlatformAdmin
	case err != nil:
		return s.internal("get user", err)
	case !u.PlatformAdmin:
		return errNeedsPlatformAdmin
	}
	return nil
}

func userMessage(u store.IamUser) *iamv1.User {
	return &iamv1.User{Id: u.ID, Email: u.Email, DisplayName: u.DisplayName, PlatformAdmin: u.PlatformAdmin}
}
