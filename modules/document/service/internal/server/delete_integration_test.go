//go:build integration

package server

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/storage/s3test"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

var errInjected = errors.New("injected failure")

// flakyObjects fails the next failDeletes deletes.
type flakyObjects struct {
	*storage.S3
	failDeletes int
}

func (f *flakyObjects) Delete(ctx context.Context, key string) error {
	if f.failDeletes > 0 {
		f.failDeletes--
		return errInjected
	}
	return f.S3.Delete(ctx, key)
}

// flakyRepo fails the next failDeletes row deletes.
type flakyRepo struct {
	*store.Repo
	failDeletes int
}

func (f *flakyRepo) DeleteDocument(ctx context.Context, p store.DeleteDocumentParams) (string, error) {
	if f.failDeletes > 0 {
		f.failDeletes--
		return "", errInjected
	}
	return f.Repo.DeleteDocument(ctx, p)
}

type harness struct {
	repo    *flakyRepo
	objects *flakyObjects
	server  *Server
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		repo:    &flakyRepo{Repo: store.NewRepo(pgtest.Start(t, "document", migrations.FS, store.ConfigurePool))},
		objects: &flakyObjects{S3: s3test.Start(t)},
	}
	h.server = New(h.repo, h.objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	return h
}

// upload creates one of alice's documents and uploads its file.
func (h *harness) upload(t *testing.T) store.DocumentDocument {
	t.Helper()
	const content = "# Notes\n"
	resp, err := h.server.CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "notes.md", ContentType: "text/markdown", SizeBytes: int64(len(content)),
	})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, resp.GetUploadUrl(), strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "text/markdown")
	put, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	put.Body.Close()
	if put.StatusCode != http.StatusOK {
		t.Fatalf("upload: %s", put.Status)
	}
	id := uuid.MustParse(resp.GetDocument().GetId())
	doc, err := h.repo.GetAnyDocument(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func (h *harness) delete(ctx context.Context, doc store.DocumentDocument) error {
	_, err := h.server.DeleteDocument(ctx, &documentv1.DeleteDocumentRequest{Id: doc.ID.String()})
	return err
}

// assertStored checks whether the document's row and object exist.
func (h *harness) assertStored(t *testing.T, doc store.DocumentDocument, wantRow, wantObject bool) {
	t.Helper()
	_, err := h.repo.GetAnyDocument(t.Context(), doc.ID)
	if got := exists(t, err, pgx.ErrNoRows); got != wantRow {
		t.Errorf("row exists = %v, want %v", got, wantRow)
	}
	_, _, err = h.objects.Stat(t.Context(), doc.ObjectKey)
	if got := exists(t, err, fs.ErrNotExist); got != wantObject {
		t.Errorf("object exists = %v, want %v", got, wantObject)
	}
}

// exists tells a lookup that found something from one that failed with missing.
func exists(t *testing.T, err, missing error) bool {
	t.Helper()
	if errors.Is(err, missing) {
		return false
	}
	if err != nil {
		t.Fatal(err)
	}
	return true
}

// assertBucketEmpty checks that no object is left behind.
func (h *harness) assertBucketEmpty(t *testing.T) {
	t.Helper()
	for obj, err := range h.objects.List(t.Context()) {
		if err != nil {
			t.Fatal(err)
		}
		t.Errorf("object %s left in the bucket", obj.Key)
	}
}

func TestDeleteDocumentRemovesTheRowAndTheObject(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t)
	if err := h.delete(asAlice(t), doc); err != nil {
		t.Fatal(err)
	}
	h.assertStored(t, doc, false, false)
	h.assertBucketEmpty(t)
}

func TestDeleteDocumentKeepsTheRowWhenTheObjectCannotBeDeleted(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t)
	h.objects.failDeletes = 1
	if err := h.delete(asAlice(t), doc); status.Code(err) != codes.Unavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
	h.assertStored(t, doc, true, true)

	if err := h.delete(asAlice(t), doc); err != nil {
		t.Fatalf("retry: %v", err)
	}
	h.assertStored(t, doc, false, false)
	h.assertBucketEmpty(t)
}

func TestDeleteDocumentCanBeRetriedWhenTheRowCannotBeDeleted(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t)
	h.repo.failDeletes = 1
	if err := h.delete(asAlice(t), doc); status.Code(err) != codes.Internal {
		t.Fatalf("err = %v, want Internal", err)
	}
	// The object is gone already; deleting it again on the retry succeeds.
	h.assertStored(t, doc, true, false)

	if err := h.delete(asAlice(t), doc); err != nil {
		t.Fatalf("retry: %v", err)
	}
	h.assertStored(t, doc, false, false)
	h.assertBucketEmpty(t)
}

func TestDeleteDocumentWhoseUploadNeverArrived(t *testing.T) {
	h := newHarness(t)
	resp, err := h.server.CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "notes.md", ContentType: "text/markdown", SizeBytes: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := h.repo.GetAnyDocument(t.Context(), uuid.MustParse(resp.GetDocument().GetId()))
	if err != nil {
		t.Fatal(err)
	}
	if err := h.delete(asAlice(t), doc); err != nil {
		t.Fatal(err)
	}
	h.assertStored(t, doc, false, false)
}

func TestDeleteDocumentOfAnotherUserTouchesNothing(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t)
	if err := h.delete(grpcserver.WithUser(t.Context(), bob), doc); status.Code(err) != codes.NotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
	h.assertStored(t, doc, true, true)
}
