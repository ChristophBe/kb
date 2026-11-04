package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
)

// fakeRepo embeds the interface so tests only implement what they use.
type fakeRepo struct {
	Repository
	created  []store.CreateDocumentParams
	list     []store.DocumentDocument
	doc      store.DocumentDocument
	marked   []store.MarkDocumentUploadedParams
	statuses []store.SetDocumentStatusParams
	updated  []store.UpdateDocumentParams
}

func (f *fakeRepo) CreateDocument(_ context.Context, p store.CreateDocumentParams) (store.DocumentDocument, error) {
	f.created = append(f.created, p)
	return store.DocumentDocument{ID: p.ID, Title: p.Title, Filename: p.Filename, Status: p.Status}, nil
}

func (f *fakeRepo) ListDocuments(_ context.Context, p store.ListDocumentsParams) ([]store.DocumentDocument, error) {
	end := min(int(p.Offset+p.Limit), len(f.list))
	return f.list[p.Offset:end], nil
}

func (f *fakeRepo) GetDocument(context.Context, uuid.UUID) (store.DocumentDocument, error) {
	if f.doc.ID == uuid.Nil {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	return f.doc, nil
}

func (f *fakeRepo) MarkDocumentUploaded(_ context.Context, p store.MarkDocumentUploadedParams) (store.DocumentDocument, error) {
	f.marked = append(f.marked, p)
	return store.DocumentDocument{ID: p.ID, Status: p.Status, SizeBytes: p.SizeBytes, ContentType: p.ContentType}, nil
}

func (f *fakeRepo) UpdateDocument(_ context.Context, p store.UpdateDocumentParams) (store.DocumentDocument, error) {
	f.updated = append(f.updated, p)
	return store.DocumentDocument{ID: p.ID, Title: p.Title.String, Metadata: p.Metadata}, nil
}

func (f *fakeRepo) SetDocumentStatus(_ context.Context, p store.SetDocumentStatusParams) (store.DocumentDocument, error) {
	f.statuses = append(f.statuses, p)
	return store.DocumentDocument{ID: p.ID, Status: p.Status}, nil
}

type fakeObjects struct {
	ObjectStore
	size        int64
	contentType string
	statErr     error
}

func (fakeObjects) PresignPut(_ context.Context, key string) (string, error) {
	return "http://s3/" + key, nil
}

func (fakeObjects) Open(context.Context, string) (io.ReadCloser, error) { return nil, io.EOF }

func (f fakeObjects) Stat(context.Context, string) (int64, string, error) {
	return f.size, f.contentType, f.statErr
}

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

func TestSetUploadedRecordsTheActualObject(t *testing.T) {
	for _, tc := range []struct {
		name, stored, want string
	}{
		{"object type wins", "text/markdown", "text/markdown"},
		{"generic type keeps the declared one", "binary/octet-stream", "application/pdf"},
		{"missing type keeps the declared one", "", "application/pdf"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "k", SizeBytes: 1, ContentType: "application/pdf"}}
			srv := New(repo, fakeObjects{size: 42, contentType: tc.stored}, slog.New(slog.DiscardHandler))
			resp, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
			if err != nil {
				t.Fatal(err)
			}
			if got := resp.GetDocument(); got.GetSizeBytes() != 42 || got.GetContentType() != tc.want {
				t.Errorf("size %d, type %q; want 42, %q", got.GetSizeBytes(), got.GetContentType(), tc.want)
			}
		})
	}
}

func TestSetUploadedFailsWithoutAnObject(t *testing.T) {
	for _, tc := range []struct {
		name    string
		statErr error
		want    codes.Code
	}{
		{"missing object", fmt.Errorf("stat k: %w", fs.ErrNotExist), codes.FailedPrecondition},
		{"storage down", errors.New("connection refused"), codes.Unavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "k"}}
			srv := New(repo, fakeObjects{statErr: tc.statErr}, slog.New(slog.DiscardHandler))
			_, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
			if status.Code(err) != tc.want {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if len(repo.marked) != 0 {
				t.Errorf("document was marked uploaded: %+v", repo.marked)
			}
		})
	}
}

func TestSetUploadedUnknownDocument(t *testing.T) {
	_, err := newServer(&fakeRepo{}).SetDocumentStatus(t.Context(), uploadedRequest(uuid.New()))
	if status.Code(err) != codes.NotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}

func TestOtherStatusesDoNotCheckTheObject(t *testing.T) {
	repo := &fakeRepo{}
	srv := New(repo, fakeObjects{statErr: fs.ErrNotExist}, slog.New(slog.DiscardHandler))
	_, err := srv.SetDocumentStatus(t.Context(), &documentv1.SetDocumentStatusRequest{
		Id: uuid.NewString(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.statuses) != 1 {
		t.Errorf("status not set: %+v", repo.statuses)
	}
}

func uploadedRequest(id uuid.UUID) *documentv1.SetDocumentStatusRequest {
	return &documentv1.SetDocumentStatusRequest{Id: id.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED}
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

func TestUpdateDocumentValidates(t *testing.T) {
	title := func(s string) *string { return &s }
	for _, tc := range []struct {
		name string
		req  *documentv1.UpdateDocumentRequest
	}{
		{"empty title", &documentv1.UpdateDocumentRequest{Title: title("")}},
		{"blank title", &documentv1.UpdateDocumentRequest{Title: title(" \t ")}},
		{"empty key", &documentv1.UpdateDocumentRequest{SetMetadata: true, Metadata: map[string]string{"": "x"}}},
		{"blank key", &documentv1.UpdateDocumentRequest{SetMetadata: true, Metadata: map[string]string{"  ": "x"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			tc.req.Id = uuid.NewString()
			_, err := newServer(repo).UpdateDocument(t.Context(), tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("err = %v, want InvalidArgument", err)
			}
			if len(repo.updated) != 0 {
				t.Errorf("document was updated: %+v", repo.updated)
			}
		})
	}
}

func TestUpdateDocumentTrimsTheTitleAndKeepsMetadata(t *testing.T) {
	repo := &fakeRepo{}
	title := "  Quarterly report  "
	resp, err := newServer(repo).UpdateDocument(t.Context(), &documentv1.UpdateDocumentRequest{
		Id: uuid.NewString(), Title: &title, SetMetadata: true, Metadata: map[string]string{"year": "2026", "empty value": ""},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.GetDocument(); got.GetTitle() != "Quarterly report" || got.GetMetadata()["year"] != "2026" {
		t.Errorf("document = %v", got)
	}
}

func TestUpdateDocumentWithoutChangesLeavesFieldsAlone(t *testing.T) {
	repo := &fakeRepo{}
	if _, err := newServer(repo).UpdateDocument(t.Context(), &documentv1.UpdateDocumentRequest{Id: uuid.NewString()}); err != nil {
		t.Fatal(err)
	}
	if p := repo.updated[0]; p.Title.Valid || p.Metadata != nil {
		t.Errorf("params = %+v", p)
	}
}
