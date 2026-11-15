//go:build integration

package store

import (
	"testing"

	"github.com/ChristophBe/knowcelium/modules/iam/migrations"
	"github.com/ChristophBe/knowcelium/platform/go/postgres/pgtest"
)

func newQueries(t *testing.T) *Queries {
	t.Helper()
	return New(pgtest.Start(t, "iam", migrations.FS))
}

func TestUpsertUserRegistersThenRefreshes(t *testing.T) {
	q, ctx := newQueries(t), t.Context()
	first, err := q.UpsertUser(ctx, UpsertUserParams{ID: "sub-1", Email: "a@example.com", DisplayName: "Ann", PlatformAdmin: true})
	if err != nil {
		t.Fatal(err)
	}
	if !first.PlatformAdmin || first.Email != "a@example.com" {
		t.Fatalf("first = %+v", first)
	}

	// The token's claims win; the admin flag is kept, not taken from the call.
	again, err := q.UpsertUser(ctx, UpsertUserParams{ID: "sub-1", Email: "ann@example.com", DisplayName: "Ann B", PlatformAdmin: false})
	if err != nil {
		t.Fatal(err)
	}
	if again.Email != "ann@example.com" || again.DisplayName != "Ann B" || !again.PlatformAdmin {
		t.Errorf("again = %+v", again)
	}
	if !again.CreatedAt.Time.Equal(first.CreatedAt.Time) {
		t.Error("created_at changed")
	}

	// A token without the claims keeps what is stored.
	bare, err := q.UpsertUser(ctx, UpsertUserParams{ID: "sub-1"})
	if err != nil {
		t.Fatal(err)
	}
	if bare.Email != "ann@example.com" || bare.DisplayName != "Ann B" {
		t.Errorf("bare = %+v", bare)
	}
}

func TestUpsertUserKeepsUsersApart(t *testing.T) {
	q, ctx := newQueries(t), t.Context()
	if _, err := q.UpsertUser(ctx, UpsertUserParams{ID: "sub-1", Email: "a@example.com"}); err != nil {
		t.Fatal(err)
	}
	other, err := q.UpsertUser(ctx, UpsertUserParams{ID: "sub-2", Email: "b@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if other.ID != "sub-2" || other.Email != "b@example.com" || other.PlatformAdmin {
		t.Errorf("other = %+v", other)
	}
}
