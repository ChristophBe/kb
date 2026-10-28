package server

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
)

// fakeRepo embeds the interface so tests only implement what they use.
type fakeRepo struct {
	Repository
	created []store.CreateDocumentParams
	list    []store.DocumentDocument
}

func (f *fakeRepo) CreateDocument(_ context.Context, p store.CreateDocumentParams) (store.DocumentDocument, error) {
	f.created = append(f.created, p)
	return store.DocumentDocument{ID: p.ID, Title: p.Title, Filename: p.Filename, Status: p.Status}, nil
}

func (f *fakeRepo) ListDocuments(_ context.Context, p store.ListDocumentsParams) ([]store.DocumentDocument, error) {
	end := min(int(p.Offset+p.Limit), len(f.list))
	return f.list[p.Offset:end], nil
}

type fakeObjects struct{ ObjectStore }

func (fakeObjects) PresignPut(_ context.Context, key string) (string, error) {
	return "http://s3/" + key, nil
}

func (fakeObjects) Open(context.Context, string) (io.ReadCloser, error) { return nil, io.EOF }

func newServer(repo *fakeRepo) *Server {
	return New(repo, fakeObjects{}, slog.New(slog.DiscardHandler))
}

func TestCreateDocumentDefaultsTitleAndPresigns(t *testing.T) {
	repo := &fakeRepo{}
	resp, err := newServer(repo).CreateDocument(t.Context(), &documentv1.CreateDocumentRequest{Filename: "notes.md"})
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.GetDocument().GetTitle(); got != "notes.md" {
		t.Errorf("title = %q, want filename", got)
	}
	if resp.GetDocument().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD {
		t.Errorf("status = %v", resp.GetDocument().GetStatus())
	}
	if want := "http://s3/" + repo.created[0].ObjectKey; resp.GetUploadUrl() != want {
		t.Errorf("upload url = %q, want %q", resp.GetUploadUrl(), want)
	}
	if repo.created[0].ContentType != "application/octet-stream" {
		t.Errorf("content type default not applied: %q", repo.created[0].ContentType)
	}
}

func TestCreateDocumentRequiresFilename(t *testing.T) {
	_, err := newServer(&fakeRepo{}).CreateDocument(t.Context(), &documentv1.CreateDocumentRequest{})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("err = %v, want InvalidArgument", err)
	}
}

func TestListDocumentsPaginates(t *testing.T) {
	repo := &fakeRepo{}
	for range 3 {
		repo.list = append(repo.list, store.DocumentDocument{ID: uuid.New()})
	}
	srv := newServer(repo)
	first, err := srv.ListDocuments(t.Context(), &documentv1.ListDocumentsRequest{Page: &commonv1.PageRequest{PageSize: 2}})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.GetDocuments()) != 2 || first.GetPage().GetNextPageToken() != "2" {
		t.Fatalf("first page: %d docs, token %q", len(first.GetDocuments()), first.GetPage().GetNextPageToken())
	}
	second, err := srv.ListDocuments(t.Context(), &documentv1.ListDocumentsRequest{
		Page: &commonv1.PageRequest{PageSize: 2, PageToken: first.GetPage().GetNextPageToken()},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.GetDocuments()) != 1 || second.GetPage().GetNextPageToken() != "" {
		t.Fatalf("second page: %d docs, token %q", len(second.GetDocuments()), second.GetPage().GetNextPageToken())
	}
}

func TestSearchChunksValidates(t *testing.T) {
	srv := newServer(&fakeRepo{})
	_, err := srv.SearchChunks(t.Context(), &documentv1.SearchChunksRequest{})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("missing embedding: err = %v", err)
	}
	_, err = srv.SearchChunks(t.Context(), &documentv1.SearchChunksRequest{Embedding: []float32{1}, DocumentIds: []string{"nope"}})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("bad id: err = %v", err)
	}
}
