package server

import (
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
)

// adminWorld is newWorld with ann bootstrapped as the platform admin.
func adminWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, srv: newServer(newMemRepo(), "ann@example.com")}
	for _, u := range []string{"ann", "bob", "cy"} {
		if _, err := w.srv.GetCurrentUser(w.as(u), &iamv1.GetCurrentUserRequest{}); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

func TestOnlyPlatformAdminsListUsers(t *testing.T) {
	w := adminWorld(t)
	resp, err := w.srv.ListUsers(w.as("ann"), &iamv1.ListUsersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetUsers()) != 3 || !resp.GetUsers()[0].GetPlatformAdmin() {
		t.Errorf("users = %v", resp.GetUsers())
	}
	_, err = w.srv.ListUsers(w.as("bob"), &iamv1.ListUsersRequest{})
	wantCode(t, "non-admin", err, codes.PermissionDenied)
	// A caller who never registered is no admin either.
	_, err = w.srv.ListUsers(w.as("ghost"), &iamv1.ListUsersRequest{})
	wantCode(t, "unregistered", err, codes.PermissionDenied)
	_, err = w.srv.ListUsers(w.t.Context(), &iamv1.ListUsersRequest{})
	wantCode(t, "no user", err, codes.Unauthenticated)
}

func TestSetPlatformAdminNeedsAPlatformAdmin(t *testing.T) {
	w := adminWorld(t)
	_, err := w.srv.SetPlatformAdmin(w.as("bob"), &iamv1.SetPlatformAdminRequest{UserId: "bob", PlatformAdmin: true})
	wantCode(t, "self-promotion", err, codes.PermissionDenied)
	if u, _ := w.srv.repo.GetUser(w.t.Context(), "bob"); u.PlatformAdmin {
		t.Error("bob promoted himself")
	}
}

func TestPromoteAndDemote(t *testing.T) {
	w := adminWorld(t)
	resp, err := w.srv.SetPlatformAdmin(w.as("ann"), &iamv1.SetPlatformAdminRequest{UserId: "bob", PlatformAdmin: true})
	if err != nil || !resp.GetUser().GetPlatformAdmin() || resp.GetUser().GetId() != "bob" {
		t.Fatalf("promote: %v, %v", resp, err)
	}
	// Bob can now demote ann, the first admin, and ann loses the right.
	if _, err := w.srv.SetPlatformAdmin(w.as("bob"), &iamv1.SetPlatformAdminRequest{UserId: "ann"}); err != nil {
		t.Fatal(err)
	}
	_, err = w.srv.ListUsers(w.as("ann"), &iamv1.ListUsersRequest{})
	wantCode(t, "demoted", err, codes.PermissionDenied)
}

func TestTheLastPlatformAdminStays(t *testing.T) {
	w := adminWorld(t)
	_, err := w.srv.SetPlatformAdmin(w.as("ann"), &iamv1.SetPlatformAdminRequest{UserId: "ann"})
	wantCode(t, "demote the last admin", err, codes.FailedPrecondition)
	var reason string
	for _, d := range status.Convert(err).Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok {
			reason = info.GetReason()
		}
	}
	if reason != "LAST_PLATFORM_ADMIN" {
		t.Errorf("reason = %q", reason)
	}
}

func TestSetPlatformAdminValidatesTheTarget(t *testing.T) {
	w := adminWorld(t)
	_, err := w.srv.SetPlatformAdmin(w.as("ann"), &iamv1.SetPlatformAdminRequest{UserId: "ghost", PlatformAdmin: true})
	wantCode(t, "unknown user", err, codes.NotFound)
	_, err = w.srv.SetPlatformAdmin(w.as("ann"), &iamv1.SetPlatformAdminRequest{})
	wantCode(t, "no user", err, codes.InvalidArgument)
}
