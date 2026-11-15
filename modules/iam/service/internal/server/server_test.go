package server

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	"github.com/ChristophBe/knowcelium/modules/iam/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// fakeRepo records the upserts and answers with the registered user.
type fakeRepo struct {
	upserts []store.UpsertUserParams
	err     error
}

func (f *fakeRepo) UpsertUser(_ context.Context, arg store.UpsertUserParams) (store.IamUser, error) {
	f.upserts = append(f.upserts, arg)
	return store.IamUser{ID: arg.ID, Email: arg.Email, DisplayName: arg.DisplayName, PlatformAdmin: arg.PlatformAdmin}, f.err
}

func newServer(repo Repository, admins ...string) *Server {
	return New(repo, admins, slog.New(slog.DiscardHandler))
}

// asUser is the context of a call the gateway made for subject, with the
// email and name headers of its token.
func asUser(t *testing.T, subject, email, name string) context.Context {
	t.Helper()
	ctx := metadata.NewIncomingContext(t.Context(), metadata.Pairs(emailHeader, email, nameHeader, name))
	return grpcserver.WithUser(ctx, subject)
}

func TestGetCurrentUserRegistersTheCallerFromTheirClaims(t *testing.T) {
	repo := &fakeRepo{}
	resp, err := newServer(repo).GetCurrentUser(asUser(t, "sub-1", "ann@example.com", "Ann"), &iamv1.GetCurrentUserRequest{})
	if err != nil {
		t.Fatal(err)
	}
	u := resp.GetUser()
	if u.GetId() != "sub-1" || u.GetEmail() != "ann@example.com" || u.GetDisplayName() != "Ann" || u.GetPlatformAdmin() {
		t.Errorf("user = %v", u)
	}
	if len(repo.upserts) != 1 || repo.upserts[0].ID != "sub-1" {
		t.Errorf("upserts = %+v", repo.upserts)
	}
}

func TestBootstrapAdminsBySubjectOrEmail(t *testing.T) {
	srv := newServer(&fakeRepo{}, " sub-root ", "", "Boss@Example.com")
	for _, tc := range []struct {
		name           string
		subject, email string
		want           bool
	}{
		{"listed subject", "sub-root", "", true},
		{"listed email, any case", "sub-2", "boss@example.com", true},
		{"other user", "sub-3", "ann@example.com", false},
		{"no email never matches the blank entry", "sub-4", "", false},
	} {
		resp, err := srv.GetCurrentUser(asUser(t, tc.subject, tc.email, ""), &iamv1.GetCurrentUserRequest{})
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got := resp.GetUser().GetPlatformAdmin(); got != tc.want {
			t.Errorf("%s: platform_admin = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestGetCurrentUserNeedsAUser(t *testing.T) {
	_, err := newServer(&fakeRepo{}).GetCurrentUser(t.Context(), &iamv1.GetCurrentUserRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("code = %v, want Unauthenticated", status.Code(err))
	}
}

func TestGetCurrentUserHidesStoreErrors(t *testing.T) {
	repo := &fakeRepo{err: errors.New("connection refused to 10.0.0.1")}
	_, err := newServer(repo).GetCurrentUser(asUser(t, "sub-1", "", ""), &iamv1.GetCurrentUserRequest{})
	if status.Code(err) != codes.Internal || strings.Contains(err.Error(), "10.0.0.1") {
		t.Errorf("err = %v", err)
	}
}
