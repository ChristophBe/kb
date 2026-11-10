//go:build integration

package store

import (
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
)

func startPending(t *testing.T, r *Repo, doc DocumentDocument, key string) (DocumentDocument, error) {
	t.Helper()
	return r.StartPendingVersion(t.Context(), StartPendingVersionParams{
		ID: doc.ID, OwnerID: doc.OwnerID, PendingStatus: 1, PendingObjectKey: key, PendingFilename: "b.md",
		PendingContentType: "text/markdown", PendingSizeBytes: 5, PendingSha256: "abc",
	})
}

func TestStartPendingVersionOnlyForASettledDocument(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	id := newDocument(t, r, "a.md") // awaiting its upload
	doc, err := r.GetAnyDocument(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startPending(t, r, doc, "k2"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("awaiting upload: err = %v, want no rows", err)
	}
	if _, err := r.ReplaceChunks(ctx, id, []InsertChunksParams{chunk(id, 0, "old", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	other := doc
	other.OwnerID = "bob"
	if _, err := startPending(t, r, other, "k2"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("another owner: err = %v, want no rows", err)
	}
	got, err := startPending(t, r, doc, "k2")
	if err != nil {
		t.Fatal(err)
	}
	if got.PendingStatus != 1 || got.PendingObjectKey != "k2" || got.Version != 1 || got.ObjectKey != id.String() {
		t.Errorf("pending = %+v", got)
	}
	// Uploaded: busy until processed or failed.
	if _, err := r.MarkPendingUploaded(ctx, MarkPendingUploadedParams{ID: id, PendingStatus: 2, PendingSizeBytes: 5, PendingContentType: "text/markdown"}); err != nil {
		t.Fatal(err)
	}
	if _, err := startPending(t, r, doc, "k3"); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("version uploaded: err = %v, want no rows", err)
	}
	if _, err := r.SetPendingStatus(ctx, SetPendingStatusParams{ID: id, PendingStatus: 5, PendingStatusDetail: "x"}); err != nil {
		t.Fatal(err)
	}
	if got, err := startPending(t, r, doc, "k3"); err != nil || got.PendingStatusDetail != "" || got.PendingStatus != 1 {
		t.Fatalf("after a failed version: %+v, %v", got, err)
	}
}

func TestReplaceChunksPromotesAnUploadedVersion(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	id := newDocument(t, r, "a.md")
	if _, err := r.ReplaceChunks(ctx, id, []InsertChunksParams{chunk(id, 0, "old", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	doc, err := r.GetAnyDocument(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startPending(t, r, doc, "k2"); err != nil {
		t.Fatal(err)
	}
	// Chunks of a run that didn't read the new file (still awaiting upload)
	// leave the pending version alone.
	if _, err := r.ReplaceChunks(ctx, id, []InsertChunksParams{chunk(id, 0, "old again", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.GetAnyDocument(ctx, id); got.Version != 1 || got.PendingStatus != 1 {
		t.Fatalf("promoted too early: %+v", got)
	}
	if _, err := r.SetPendingStatus(ctx, SetPendingStatusParams{ID: id, PendingStatus: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReplaceChunks(ctx, id, []InsertChunksParams{chunk(id, 0, "new", axis(1)), chunk(id, 1, "new 1", axis(2))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetAnyDocument(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != id || got.Version != 2 || got.ObjectKey != "k2" || got.Filename != "b.md" || got.ContentType != "text/markdown" ||
		got.SizeBytes != 5 || got.Sha256 != "abc" || got.ChunkCount != 2 || got.Status != readyStatus ||
		got.PendingStatus != 0 || got.PendingObjectKey != "" || got.Title != "a.md" {
		t.Errorf("after promotion: %+v", got)
	}
	if rows := search(t, r, axis(1), 10); len(rows) != 2 || rows[0].Text != "new" {
		t.Errorf("chunks = %+v", rows)
	}
}

func TestExistingObjectKeysIncludesPendingFiles(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	id := newDocument(t, r, "a.md")
	if _, err := r.ReplaceChunks(ctx, id, []InsertChunksParams{chunk(id, 0, "old", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	doc, err := r.GetAnyDocument(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startPending(t, r, doc, "pending-key"); err != nil {
		t.Fatal(err)
	}
	got, err := r.ExistingObjectKeys(ctx, []string{id.String(), "pending-key", "orphan"})
	slices.Sort(got)
	if err != nil || !slices.Equal(got, []string{id.String(), "pending-key"}) {
		t.Errorf("existing keys = %v, %v", got, err)
	}
}
