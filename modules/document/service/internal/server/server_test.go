package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
	"github.com/christoph/kb/platform/go/grpcserver"
)

const (
	alice = "alice-subject"
	bob   = "bob-subject"
)

// asAlice is the context of a call alice made through the gateway.
func asAlice(t *testing.T) context.Context { return grpcserver.WithUser(t.Context(), alice) }

// fakeRepo embeds the interface so tests only implement what they use. Its
// documents belong to alice unless a test says otherwise.
type fakeRepo struct {
	Repository
	created  []store.CreateDocumentParams
	list     []store.DocumentDocument
	doc      store.DocumentDocument
	marked   []store.MarkDocumentUploadedParams
	statuses []store.SetDocumentStatusParams
	updated  []store.UpdateDocumentParams
	deleted  []uuid.UUID
	chunks   []store.ListChunksRow
	chunkReq []store.ListChunksParams
	found    []store.SearchChunksRow
	searches []store.SearchChunksParams
	best     []store.SearchBestChunksRow
	bestReq  []store.SearchBestChunksParams
}

func (f *fakeRepo) CreateDocument(_ context.Context, p store.CreateDocumentParams) (store.DocumentDocument, error) {
	f.created = append(f.created, p)
	return store.DocumentDocument{ID: p.ID, OwnerID: p.OwnerID, Title: p.Title, Filename: p.Filename, Status: p.Status}, nil
}

// ListDocuments behaves like the query: the owner's documents, paged.
func (f *fakeRepo) ListDocuments(_ context.Context, p store.ListDocumentsParams) ([]store.DocumentDocument, error) {
	owned := []store.DocumentDocument{}
	for _, d := range f.list {
		if owner(d) == p.OwnerID {
			owned = append(owned, d)
		}
	}
	end := min(int(p.Offset+p.Limit), len(owned))
	return owned[p.Offset:end], nil
}

func (f *fakeRepo) GetDocument(_ context.Context, p store.GetDocumentParams) (store.DocumentDocument, error) {
	if f.doc.ID == uuid.Nil || owner(f.doc) != p.OwnerID {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	return f.doc, nil
}

func (f *fakeRepo) GetAnyDocument(context.Context, uuid.UUID) (store.DocumentDocument, error) {
	if f.doc.ID == uuid.Nil {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	return f.doc, nil
}

func (f *fakeRepo) DeleteDocument(_ context.Context, p store.DeleteDocumentParams) (string, error) {
	if f.doc.ID != p.ID || owner(f.doc) != p.OwnerID {
		return "", pgx.ErrNoRows
	}
	f.deleted = append(f.deleted, p.ID)
	return f.doc.ObjectKey, nil
}

// owner is a fake document's owner: alice unless set.
func owner(d store.DocumentDocument) string {
	if d.OwnerID == "" {
		return alice
	}
	return d.OwnerID
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

// ListChunks behaves like the query: chunks after AfterIdx, in index order.
func (f *fakeRepo) ListChunks(_ context.Context, p store.ListChunksParams) ([]store.ListChunksRow, error) {
	f.chunkReq = append(f.chunkReq, p)
	rows := []store.ListChunksRow{}
	for _, c := range f.chunks {
		if c.DocumentID == p.DocumentID && c.Idx > p.AfterIdx && len(rows) < int(p.MaxResults) {
			rows = append(rows, c)
		}
	}
	return rows, nil
}

func (f *fakeRepo) SearchChunks(_ context.Context, p store.SearchChunksParams) ([]store.SearchChunksRow, error) {
	f.searches = append(f.searches, p)
	return f.found, nil
}

func (f *fakeRepo) SearchBestChunks(_ context.Context, p store.SearchBestChunksParams) ([]store.SearchBestChunksRow, error) {
	f.bestReq = append(f.bestReq, p)
	return f.best, nil
}

// fakeLLM answers Embed with one fixed vector per input, or fails with err.
type fakeLLM struct {
	llmv1.LlmServiceClient
	err    error
	calls  []*llmv1.EmbedRequest
	vector []float32
}

func (f *fakeLLM) Embed(_ context.Context, req *llmv1.EmbedRequest, _ ...grpc.CallOption) (*llmv1.EmbedResponse, error) {
	f.calls = append(f.calls, req)
	if f.err != nil {
		return nil, f.err
	}
	resp := &llmv1.EmbedResponse{}
	for range req.GetInputs() {
		resp.Embeddings = append(resp.Embeddings, &llmv1.Embedding{Values: f.vector})
	}
	return resp, nil
}

type fakeObjects struct {
	ObjectStore
	size        int64
	contentType string
	statErr     error
	// content is what Open reads; "content" when empty.
	content string
}

// PresignPut encodes the signed size and type in the URL for tests to check.
func (fakeObjects) PresignPut(_ context.Context, key, contentType string, size int64) (string, error) {
	return fmt.Sprintf("http://s3/%s?type=%s&size=%d", key, contentType, size), nil
}

func (f fakeObjects) Open(context.Context, string) (io.ReadCloser, error) {
	if f.content == "" {
		return io.NopCloser(strings.NewReader("content")), nil
	}
	return io.NopCloser(strings.NewReader(f.content)), nil
}

func (fakeObjects) PresignGet(_ context.Context, key, _ string) (string, error) {
	return "http://s3/" + key, nil
}

func (fakeObjects) Delete(context.Context, string) error { return nil }

func (f fakeObjects) Stat(context.Context, string) (int64, string, error) {
	return f.size, f.contentType, f.statErr
}

// testLimits mirror the defaults: 50 MiB of PDF, text, JSON or YAML.
var testLimits = Limits{
	MaxUploadBytes:      50 << 20,
	AllowedContentTypes: []string{"application/pdf", "text/*", "application/json", "application/yaml"},
}

func newServer(repo *fakeRepo) *Server {
	return New(repo, fakeObjects{}, &fakeLLM{vector: []float32{1, 0}}, testLimits, slog.New(slog.DiscardHandler))
}

func TestCreateDocumentDefaultsTitleAndPresigns(t *testing.T) {
	repo := &fakeRepo{}
	resp, err := newServer(repo).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "notes.md", ContentType: "text/markdown", SizeBytes: 42,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.GetDocument().GetTitle(); got != "notes.md" {
		t.Errorf("title = %q, want filename", got)
	}
	if resp.GetDocument().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD {
		t.Errorf("status = %v", resp.GetDocument().GetStatus())
	}
	if want := "http://s3/" + repo.created[0].ObjectKey + "?type=text/markdown&size=42"; resp.GetUploadUrl() != want {
		t.Errorf("upload url = %q, want %q (signed for the declared type and size)", resp.GetUploadUrl(), want)
	}
}

func TestCreateDocumentTypesGenericFilesByExtension(t *testing.T) {
	for _, tc := range []struct{ declared, filename, want string }{
		{"", "notes.md", "text/markdown"},
		{"application/octet-stream", "config.YML", "application/yaml"},
		{"text/plain", "notes.md", "text/plain"},
	} {
		repo := &fakeRepo{}
		_, err := newServer(repo).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
			Filename: tc.filename, ContentType: tc.declared, SizeBytes: 1,
		})
		if err != nil {
			t.Fatalf("%q %s: %v", tc.declared, tc.filename, err)
		}
		if got := repo.created[0].ContentType; got != tc.want {
			t.Errorf("%q %s: stored type %q, want %q", tc.declared, tc.filename, got, tc.want)
		}
	}
}

func TestCreateDocumentRejectsFilesOutsideTheLimits(t *testing.T) {
	for _, tc := range []struct {
		name  string
		req   *documentv1.CreateDocumentRequest
		field string
		want  string
	}{
		{"empty", &documentv1.CreateDocumentRequest{Filename: "a.md"}, "size_bytes", "The file is empty"},
		{"oversize", &documentv1.CreateDocumentRequest{Filename: "a.pdf", SizeBytes: 50<<20 + 1},
			"size_bytes", "The file is larger than the limit of 50 MiB"},
		{"disallowed type", &documentv1.CreateDocumentRequest{Filename: "a.docx", ContentType: "application/msword", SizeBytes: 1},
			"content_type", "Files of type application/msword are not accepted"},
		{"unknown extension", &documentv1.CreateDocumentRequest{Filename: "a.bin", SizeBytes: 1},
			"content_type", "Files of type application/octet-stream are not accepted"},
		{"bad checksum", &documentv1.CreateDocumentRequest{Filename: "a.md", SizeBytes: 1, Sha256: "abc"},
			"sha256", "The checksum must be a SHA-256 in hex"},
		{"long title", &documentv1.CreateDocumentRequest{Filename: "a.md", SizeBytes: 1, Title: strings.Repeat("x", 201)},
			"title", "Title must not be longer than 200 characters"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			_, err := newServer(repo).CreateDocument(asAlice(t), tc.req)
			v := grpcserver.FieldViolations(err)
			if status.Code(err) != codes.InvalidArgument || len(v) != 1 || v[0].GetField() != tc.field || v[0].GetDescription() != tc.want {
				t.Fatalf("err = %v, violations %v; want %s: %q", err, v, tc.field, tc.want)
			}
			if len(repo.created) != 0 {
				t.Errorf("document was created: %+v", repo.created)
			}
		})
	}
}

func TestCreateDocumentReportsEveryViolation(t *testing.T) {
	_, err := newServer(&fakeRepo{}).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "a.exe", ContentType: "application/x-msdownload", SizeBytes: 1 << 40,
	})
	var fields []string
	for _, v := range grpcserver.FieldViolations(err) {
		fields = append(fields, v.GetField())
	}
	if !slices.Equal(fields, []string{"size_bytes", "content_type"}) {
		t.Errorf("violated fields = %v, want size_bytes and content_type", fields)
	}
}

func TestCreateDocumentAllowsTypeWildcardsAndParameters(t *testing.T) {
	srv := newServer(&fakeRepo{})
	for _, ct := range []string{"text/csv", "text/plain; charset=utf-8", "application/PDF"} {
		if _, err := srv.CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
			Filename: "f", ContentType: ct, SizeBytes: 1,
		}); err != nil {
			t.Errorf("%s: %v", ct, err)
		}
	}
}

func TestCreateDocumentStoresTheChecksumInLowercase(t *testing.T) {
	repo := &fakeRepo{}
	sum := strings.ToUpper(contentSHA256)
	if _, err := newServer(repo).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "a.md", SizeBytes: 7, Sha256: sum,
	}); err != nil {
		t.Fatal(err)
	}
	if repo.created[0].Sha256 != contentSHA256 {
		t.Errorf("stored checksum %q, want %q", repo.created[0].Sha256, contentSHA256)
	}
}

// contentSHA256 is the SHA-256 of "content", what fakeObjects stores.
const contentSHA256 = "ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73"

func TestCreateDocumentRequiresFilename(t *testing.T) {
	_, err := newServer(&fakeRepo{}).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{})
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
	first, err := srv.ListDocuments(asAlice(t), &documentv1.ListDocumentsRequest{Page: &commonv1.PageRequest{PageSize: 2}})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.GetDocuments()) != 2 || first.GetPage().GetNextPageToken() != "2" {
		t.Fatalf("first page: %d docs, token %q", len(first.GetDocuments()), first.GetPage().GetNextPageToken())
	}
	second, err := srv.ListDocuments(asAlice(t), &documentv1.ListDocumentsRequest{
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
			srv := New(repo, fakeObjects{size: 42, contentType: tc.stored}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
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
			srv := New(repo, fakeObjects{statErr: tc.statErr}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
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

func TestSetUploadedVerifiesTheChecksum(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "k", Sha256: contentSHA256}}
	srv := New(repo, fakeObjects{size: 7}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	resp, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
	if err != nil {
		t.Fatal(err)
	}
	if resp.GetDocument().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED || len(repo.statuses) != 0 {
		t.Errorf("status %v, other statuses set %+v; want UPLOADED", resp.GetDocument().GetStatus(), repo.statuses)
	}
}

func TestSetUploadedFailsARejectedFile(t *testing.T) {
	for _, tc := range []struct {
		name    string
		objects fakeObjects
		reason  string
	}{
		{"checksum mismatch", fakeObjects{size: 8, content: "tampered"}, "The uploaded file does not match its checksum"},
		{"oversize", fakeObjects{size: 50<<20 + 1}, "The file is larger than the limit of 50 MiB"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "k", Sha256: contentSHA256}}
			srv := New(repo, tc.objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
			_, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
			if status.Code(err) != codes.FailedPrecondition || status.Convert(err).Message() != tc.reason {
				t.Fatalf("err = %v, want FailedPrecondition %q", err, tc.reason)
			}
			if reason := errorReason(err); reason != "UPLOAD_REJECTED" {
				t.Errorf("reason = %q, want UPLOAD_REJECTED", reason)
			}
			if len(repo.marked) != 0 {
				t.Errorf("document was marked uploaded: %+v", repo.marked)
			}
			want := store.SetDocumentStatusParams{
				ID: repo.doc.ID, Status: int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED), StatusDetail: tc.reason,
			}
			if len(repo.statuses) != 1 || repo.statuses[0] != want {
				t.Errorf("statuses = %+v, want %+v", repo.statuses, want)
			}
		})
	}
}

func errorReason(err error) string {
	for _, d := range status.Convert(err).Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok {
			return info.GetReason()
		}
	}
	return ""
}

func TestSetUploadedUnknownDocument(t *testing.T) {
	_, err := newServer(&fakeRepo{}).SetDocumentStatus(t.Context(), uploadedRequest(uuid.New()))
	if status.Code(err) != codes.NotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}

func TestOtherStatusesDoNotCheckTheObject(t *testing.T) {
	repo := &fakeRepo{}
	srv := New(repo, fakeObjects{statErr: fs.ErrNotExist}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
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
	_, err := srv.SearchChunks(asAlice(t), &documentv1.SearchChunksRequest{})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("missing embedding: err = %v", err)
	}
	_, err = srv.SearchChunks(asAlice(t), &documentv1.SearchChunksRequest{Embedding: []float32{1}, DocumentIds: []string{"nope"}})
	if v := grpcserver.FieldViolations(err); status.Code(err) != codes.InvalidArgument || len(v) != 1 || v[0].GetField() != "document_ids[0]" {
		t.Errorf("bad id: err = %v, violations %v", err, v)
	}
}

func TestSearchDocumentsEmbedsTheQueryAndSearches(t *testing.T) {
	docID := uuid.New()
	repo := &fakeRepo{found: []store.SearchChunksRow{{
		DocumentID: docID, Idx: 3, Text: "Revenue grew.", Metadata: map[string]string{"page": "2"},
		DocumentTitle: "Quarterly report", Score: 0.82,
	}}}
	llm := &fakeLLM{vector: []float32{0.5, 0.25}}
	srv := New(repo, fakeObjects{}, llm, testLimits, slog.New(slog.DiscardHandler))
	resp, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{
		Query: "  revenue growth ", DocumentIds: []string{docID.String()},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(llm.calls) != 1 || !slices.Equal(llm.calls[0].GetInputs(), []string{"revenue growth"}) {
		t.Fatalf("embed calls = %v, want the trimmed query once", llm.calls)
	}
	search := repo.searches[0]
	if !slices.Equal(search.Embedding.Slice(), llm.vector) {
		t.Errorf("searched with %v, want the query's embedding", search.Embedding.Slice())
	}
	if search.MaxResults != defaultLimit || !slices.Equal(search.DocumentIds, []uuid.UUID{docID}) {
		t.Errorf("search params = %+v", search)
	}
	if len(resp.GetResults()) != 1 {
		t.Fatalf("results = %v", resp.GetResults())
	}
	got := resp.GetResults()[0]
	if got.GetChunk().GetDocumentId() != docID.String() || got.GetChunk().GetIndex() != 3 ||
		got.GetDocumentTitle() != "Quarterly report" || got.GetScore() != float32(0.82) {
		t.Errorf("result = %v", got)
	}
}

func TestSearchDocumentsCapsTheLimit(t *testing.T) {
	repo := &fakeRepo{}
	if _, err := newServer(repo).SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q", Limit: 1000}); err != nil {
		t.Fatal(err)
	}
	if repo.searches[0].MaxResults != maxLimit || repo.bestReq[0].MaxResults != maxLimit {
		t.Errorf("limits = %d, %d, want %d", repo.searches[0].MaxResults, repo.bestReq[0].MaxResults, maxLimit)
	}
}

func TestSearchDocumentsReturnsEachDocumentOnceWithItsBestChunk(t *testing.T) {
	report, notes := uuid.New(), uuid.New()
	repo := &fakeRepo{best: []store.SearchBestChunksRow{
		{DocumentID: report, Idx: 4, Text: "Revenue grew.", Metadata: map[string]string{}, DocumentTitle: "Quarterly report", Score: 0.9},
		{DocumentID: notes, Idx: 0, Text: "Revenue notes.", DocumentTitle: "Notes", Score: 0.4},
	}}
	llm := &fakeLLM{vector: []float32{0.5, 0.25}}
	srv := New(repo, fakeObjects{}, llm, testLimits, slog.New(slog.DiscardHandler))
	resp, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "revenue", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(llm.calls) != 1 {
		t.Errorf("embedded %d times, want once for both searches", len(llm.calls))
	}
	req := repo.bestReq[0]
	if req.MaxResults != 2 || !slices.Equal(req.Embedding.Slice(), llm.vector) {
		t.Errorf("best-chunk search params = %+v", req)
	}
	docs := resp.GetDocuments()
	if len(docs) != 2 || docs[0].GetDocumentId() != report.String() || docs[1].GetDocumentId() != notes.String() {
		t.Fatalf("documents = %v, want report then notes", docs)
	}
	got := docs[0]
	if got.GetTitle() != "Quarterly report" || got.GetScore() != float32(0.9) ||
		got.GetBestChunk().GetIndex() != 4 || got.GetBestChunk().GetText() != "Revenue grew." ||
		got.GetBestChunk().GetDocumentId() != report.String() {
		t.Errorf("document = %v", got)
	}
}

func TestSearchDocumentsValidatesBeforeEmbedding(t *testing.T) {
	for _, tc := range []struct {
		name string
		req  *documentv1.SearchDocumentsRequest
	}{
		{"empty query", &documentv1.SearchDocumentsRequest{}},
		{"blank query", &documentv1.SearchDocumentsRequest{Query: " \t\n"}},
		{"bad document id", &documentv1.SearchDocumentsRequest{Query: "q", DocumentIds: []string{"nope"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			llm := &fakeLLM{}
			_, err := New(&fakeRepo{}, fakeObjects{}, llm, testLimits, slog.New(slog.DiscardHandler)).SearchDocuments(asAlice(t), tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Errorf("err = %v, want InvalidArgument", err)
			}
			if len(llm.calls) != 0 {
				t.Errorf("llm was called: %v", llm.calls)
			}
		})
	}
}

func TestSearchDocumentsMapsLLMErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want codes.Code
	}{
		{"llm down", status.Error(codes.Unavailable, "down"), codes.Unavailable},
		{"llm too slow", status.Error(codes.DeadlineExceeded, "slow"), codes.Unavailable},
		// llm's own NOT_FOUND (an unknown model) is not a missing document.
		{"llm rejects", status.Error(codes.NotFound, "no such model"), codes.Internal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			srv := New(repo, fakeObjects{}, &fakeLLM{err: tc.err}, testLimits, slog.New(slog.DiscardHandler))
			_, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q"})
			if status.Code(err) != tc.want {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
			if len(repo.searches) != 0 {
				t.Errorf("searched without an embedding")
			}
		})
	}
}

func TestSearchDocumentsRejectsAnEmptyEmbedding(t *testing.T) {
	srv := New(&fakeRepo{}, fakeObjects{}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	_, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q"})
	if status.Code(err) != codes.Internal {
		t.Errorf("err = %v, want Internal", err)
	}
}

// With a real, lazily dialled client and nothing listening, search fails with
// UNAVAILABLE and the RPCs that don't need llm still work.
func TestSearchDocumentsWithLLMDown(t *testing.T) {
	var lc net.ListenConfig
	lis, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := lis.Addr().String()
	if err := lis.Close(); err != nil {
		t.Fatal(err)
	}
	conn, err := grpcserver.Dial(addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	repo := &fakeRepo{list: []store.DocumentDocument{{ID: uuid.New()}}}
	srv := New(repo, fakeObjects{}, llmv1.NewLlmServiceClient(conn), testLimits, slog.New(slog.DiscardHandler))

	_, err = srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q"})
	if status.Code(err) != codes.Unavailable {
		t.Errorf("search: err = %v, want Unavailable", err)
	}
	if reason := errorReason(err); reason != "LLM_UNAVAILABLE" {
		t.Errorf("search: ErrorInfo reason = %q, want LLM_UNAVAILABLE", reason)
	}
	resp, err := srv.ListDocuments(asAlice(t), &documentv1.ListDocumentsRequest{})
	if err != nil || len(resp.GetDocuments()) != 1 {
		t.Errorf("list: %v, %v", resp, err)
	}
}

func TestUpdateDocumentValidates(t *testing.T) {
	title := func(s string) *string { return &s }
	for _, tc := range []struct {
		name  string
		req   *documentv1.UpdateDocumentRequest
		field string
	}{
		{"empty title", &documentv1.UpdateDocumentRequest{Title: title("")}, "title"},
		{"blank title", &documentv1.UpdateDocumentRequest{Title: title(" \t ")}, "title"},
		{"long title", &documentv1.UpdateDocumentRequest{Title: title(strings.Repeat("ä", maxTitleLength+1))}, "title"},
		{"empty key", &documentv1.UpdateDocumentRequest{SetMetadata: true, Metadata: map[string]string{"": "x"}}, "metadata"},
		{"blank key", &documentv1.UpdateDocumentRequest{SetMetadata: true, Metadata: map[string]string{"  ": "x"}}, "metadata"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{}
			tc.req.Id = uuid.NewString()
			_, err := newServer(repo).UpdateDocument(asAlice(t), tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("err = %v, want InvalidArgument", err)
			}
			if v := grpcserver.FieldViolations(err); len(v) != 1 || v[0].GetField() != tc.field {
				t.Errorf("violations %v, want one for %q", v, tc.field)
			}
			if len(repo.updated) != 0 {
				t.Errorf("document was updated: %+v", repo.updated)
			}
		})
	}
}

func TestUpdateDocumentAcceptsATitleOfMaximumLength(t *testing.T) {
	title := strings.Repeat("ä", maxTitleLength)
	repo := &fakeRepo{}
	if _, err := newServer(repo).UpdateDocument(asAlice(t), &documentv1.UpdateDocumentRequest{Id: uuid.NewString(), Title: &title}); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateDocumentTrimsTheTitleAndKeepsMetadata(t *testing.T) {
	repo := &fakeRepo{}
	title := "  Quarterly report  "
	resp, err := newServer(repo).UpdateDocument(asAlice(t), &documentv1.UpdateDocumentRequest{
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
	if _, err := newServer(repo).UpdateDocument(asAlice(t), &documentv1.UpdateDocumentRequest{Id: uuid.NewString()}); err != nil {
		t.Fatal(err)
	}
	if p := repo.updated[0]; p.Title.Valid || p.Metadata != nil {
		t.Errorf("params = %+v", p)
	}
}

func TestListChunksPaginatesInIndexOrder(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New()}}
	for i := range 5 {
		repo.chunks = append(repo.chunks, store.ListChunksRow{
			DocumentID: repo.doc.ID, Idx: int32(i), Text: fmt.Sprintf("chunk %d", i), Metadata: map[string]string{"page": "1"},
		})
	}
	srv := newServer(repo)
	var got []int32
	token := ""
	for range 3 {
		resp, err := srv.ListChunks(asAlice(t), &documentv1.ListChunksRequest{
			DocumentId: repo.doc.ID.String(), Page: &commonv1.PageRequest{PageSize: 2, PageToken: token},
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range resp.GetChunks() {
			if c.GetDocumentId() != repo.doc.ID.String() || c.GetText() != fmt.Sprintf("chunk %d", c.GetIndex()) || c.GetMetadata()["page"] != "1" {
				t.Errorf("chunk = %v", c)
			}
			got = append(got, c.GetIndex())
		}
		token = resp.GetPage().GetNextPageToken()
		if token == "" {
			break
		}
	}
	if fmt.Sprint(got) != "[0 1 2 3 4]" || token != "" {
		t.Fatalf("indices %v, last token %q; want [0 1 2 3 4] and no token", got, token)
	}
}

func TestListChunksDefaultsAndCapsThePageSize(t *testing.T) {
	for _, tc := range []struct {
		size, want int32
	}{{0, defaultPageSize}, {-3, defaultPageSize}, {maxPageSize + 1, maxPageSize}} {
		repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New()}}
		_, err := newServer(repo).ListChunks(asAlice(t), &documentv1.ListChunksRequest{
			DocumentId: repo.doc.ID.String(), Page: &commonv1.PageRequest{PageSize: tc.size},
		})
		if err != nil {
			t.Fatal(err)
		}
		if p := repo.chunkReq[0]; p.MaxResults != tc.want+1 || p.AfterIdx != -1 {
			t.Errorf("size %d: params = %+v", tc.size, p)
		}
	}
}

func TestListChunksEmptyDocument(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New()}}
	resp, err := newServer(repo).ListChunks(asAlice(t), &documentv1.ListChunksRequest{DocumentId: repo.doc.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetChunks()) != 0 || resp.GetPage().GetNextPageToken() != "" {
		t.Errorf("resp = %v", resp)
	}
}

func TestListChunksUnknownDocument(t *testing.T) {
	_, err := newServer(&fakeRepo{}).ListChunks(asAlice(t), &documentv1.ListChunksRequest{DocumentId: uuid.NewString()})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}

func TestListChunksValidates(t *testing.T) {
	id := uuid.New()
	for _, tc := range []struct {
		name, id, token string
	}{
		{"missing id", "", ""},
		{"malformed id", "nope", ""},
		{"token not base64", id.String(), "!!"},
		{"token not a number", id.String(), encode("x")},
		{"negative token", id.String(), encode("-1")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{doc: store.DocumentDocument{ID: id}}
			_, err := newServer(repo).ListChunks(asAlice(t), &documentv1.ListChunksRequest{
				DocumentId: tc.id, Page: &commonv1.PageRequest{PageToken: tc.token},
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("err = %v, want InvalidArgument", err)
			}
			if len(repo.chunkReq) != 0 {
				t.Errorf("chunks were queried: %+v", repo.chunkReq)
			}
		})
	}
}

func encode(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }

func TestUserRPCsRequireAUser(t *testing.T) {
	id := uuid.NewString()
	for name, call := range map[string]func(*Server, context.Context) error{
		"CreateDocument": func(s *Server, ctx context.Context) error {
			_, err := s.CreateDocument(ctx, &documentv1.CreateDocumentRequest{Filename: "a.md", SizeBytes: 1})
			return err
		},
		"GetDocument": func(s *Server, ctx context.Context) error {
			_, err := s.GetDocument(ctx, &documentv1.GetDocumentRequest{Id: id})
			return err
		},
		"ListDocuments": func(s *Server, ctx context.Context) error {
			_, err := s.ListDocuments(ctx, &documentv1.ListDocumentsRequest{})
			return err
		},
		"UpdateDocument": func(s *Server, ctx context.Context) error {
			_, err := s.UpdateDocument(ctx, &documentv1.UpdateDocumentRequest{Id: id})
			return err
		},
		"DeleteDocument": func(s *Server, ctx context.Context) error {
			_, err := s.DeleteDocument(ctx, &documentv1.DeleteDocumentRequest{Id: id})
			return err
		},
		"GetDownloadUrl": func(s *Server, ctx context.Context) error {
			_, err := s.GetDownloadUrl(ctx, &documentv1.GetDownloadUrlRequest{Id: id})
			return err
		},
		"ListChunks": func(s *Server, ctx context.Context) error {
			_, err := s.ListChunks(ctx, &documentv1.ListChunksRequest{DocumentId: id})
			return err
		},
		"SearchChunks": func(s *Server, ctx context.Context) error {
			_, err := s.SearchChunks(ctx, &documentv1.SearchChunksRequest{Embedding: []float32{1}})
			return err
		},
		"SearchDocuments": func(s *Server, ctx context.Context) error {
			_, err := s.SearchDocuments(ctx, &documentv1.SearchDocumentsRequest{Query: "q"})
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepo{}
			if err := call(newServer(repo), t.Context()); status.Code(err) != codes.Unauthenticated {
				t.Errorf("err = %v, want Unauthenticated", err)
			}
			if len(repo.created)+len(repo.updated)+len(repo.searches)+len(repo.bestReq)+len(repo.chunkReq) != 0 {
				t.Errorf("the repository was used: %+v", repo)
			}
		})
	}
}

func TestCreateDocumentIsOwnedByTheCaller(t *testing.T) {
	repo := &fakeRepo{}
	resp, err := newServer(repo).CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{Filename: "a.md", SizeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	if repo.created[0].OwnerID != alice || resp.GetDocument().GetOwnerId() != alice {
		t.Errorf("owner = %q, response owner = %q; want %q", repo.created[0].OwnerID, resp.GetDocument().GetOwnerId(), alice)
	}
}

func TestListDocumentsListsOnlyTheCallersDocuments(t *testing.T) {
	mine := uuid.New()
	repo := &fakeRepo{list: []store.DocumentDocument{{ID: uuid.New(), OwnerID: bob}, {ID: mine, OwnerID: alice}}}
	resp, err := newServer(repo).ListDocuments(asAlice(t), &documentv1.ListDocumentsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if docs := resp.GetDocuments(); len(docs) != 1 || docs[0].GetId() != mine.String() || docs[0].GetOwnerId() != alice {
		t.Errorf("documents = %v, want only alice's", docs)
	}
}

// Another user's document looks exactly like one that doesn't exist.
func TestAnotherUsersDocumentIsNotFound(t *testing.T) {
	theirs := store.DocumentDocument{ID: uuid.New(), OwnerID: bob, ObjectKey: "k"}
	id := theirs.ID.String()
	for name, call := range map[string]func(*Server, context.Context) error{
		"GetDocument": func(s *Server, ctx context.Context) error {
			_, err := s.GetDocument(ctx, &documentv1.GetDocumentRequest{Id: id})
			return err
		},
		"DeleteDocument": func(s *Server, ctx context.Context) error {
			_, err := s.DeleteDocument(ctx, &documentv1.DeleteDocumentRequest{Id: id})
			return err
		},
		"GetDownloadUrl": func(s *Server, ctx context.Context) error {
			_, err := s.GetDownloadUrl(ctx, &documentv1.GetDownloadUrlRequest{Id: id})
			return err
		},
		"ListChunks": func(s *Server, ctx context.Context) error {
			_, err := s.ListChunks(ctx, &documentv1.ListChunksRequest{DocumentId: id})
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			repo := &fakeRepo{doc: theirs}
			if err := call(newServer(repo), asAlice(t)); status.Code(err) != codes.NotFound {
				t.Errorf("err = %v, want NotFound", err)
			}
			if len(repo.deleted)+len(repo.chunkReq) != 0 {
				t.Errorf("the document was touched: deleted %v, chunk queries %v", repo.deleted, repo.chunkReq)
			}
			if err := call(newServer(repo), grpcserver.WithUser(t.Context(), bob)); err != nil {
				t.Errorf("as the owner: %v", err)
			}
		})
	}
}

func TestUpdateDocumentUpdatesOnlyTheCallersDocument(t *testing.T) {
	repo := &fakeRepo{}
	if _, err := newServer(repo).UpdateDocument(asAlice(t), &documentv1.UpdateDocumentRequest{Id: uuid.NewString()}); err != nil {
		t.Fatal(err)
	}
	if repo.updated[0].OwnerID != alice {
		t.Errorf("updated for owner %q, want %q", repo.updated[0].OwnerID, alice)
	}
}

func TestSearchesFindOnlyTheCallersChunks(t *testing.T) {
	repo := &fakeRepo{}
	srv := newServer(repo)
	if _, err := srv.SearchChunks(asAlice(t), &documentv1.SearchChunksRequest{Embedding: []float32{1}}); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q"}); err != nil {
		t.Fatal(err)
	}
	for i, s := range repo.searches {
		if s.OwnerID != alice {
			t.Errorf("chunk search %d for owner %q, want %q", i, s.OwnerID, alice)
		}
	}
	if len(repo.searches) != 2 || repo.bestReq[0].OwnerID != alice {
		t.Errorf("searches %+v, best-chunk searches %+v", repo.searches, repo.bestReq)
	}
}

// readStream collects what ReadContent sends.
type readStream struct {
	grpc.ServerStream
	ctx  context.Context
	data []byte
}

func (s *readStream) Context() context.Context { return s.ctx }

func (s *readStream) Send(r *documentv1.ReadContentResponse) error {
	s.data = append(s.data, r.GetData()...)
	return nil
}

// The ingestion worker runs without a user and works on everyone's documents.
func TestPipelineRPCsActOnAnyDocumentWithoutAUser(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), OwnerID: bob, ObjectKey: "k"}}
	srv := newServer(repo)
	stream := &readStream{ctx: t.Context()}
	if err := srv.ReadContent(&documentv1.ReadContentRequest{Id: repo.doc.ID.String()}, stream); err != nil {
		t.Fatal(err)
	}
	if string(stream.data) != "content" {
		t.Errorf("content = %q", stream.data)
	}
	if _, err := srv.SetDocumentStatus(t.Context(), &documentv1.SetDocumentStatusRequest{
		Id: repo.doc.ID.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING,
	}); err != nil {
		t.Fatal(err)
	}
}

// deletingObjects records the objects deleted, failing with err if set.
type deletingObjects struct {
	fakeObjects
	deleted []string
	err     error
}

func (d *deletingObjects) Delete(_ context.Context, key string) error {
	if d.err != nil {
		return d.err
	}
	d.deleted = append(d.deleted, key)
	return nil
}

func deleteDocument(t *testing.T, ctx context.Context, repo *fakeRepo, objects *deletingObjects) error {
	t.Helper()
	s := New(repo, objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	_, err := s.DeleteDocument(ctx, &documentv1.DeleteDocumentRequest{Id: repo.doc.ID.String()})
	return err
}

func TestDeleteDocumentDeletesTheObjectAndTheRow(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "id/a.md"}}
	objects := &deletingObjects{}
	if err := deleteDocument(t, asAlice(t), repo, objects); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(objects.deleted, []string{"id/a.md"}) || len(repo.deleted) != 1 {
		t.Errorf("deleted objects %v, rows %v", objects.deleted, repo.deleted)
	}
}

func TestDeleteDocumentKeepsTheRowWhileTheObjectCannotBeDeleted(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), ObjectKey: "id/a.md"}}
	err := deleteDocument(t, asAlice(t), repo, &deletingObjects{err: errors.New("s3 down")})
	if status.Code(err) != codes.Unavailable {
		t.Errorf("err = %v, want Unavailable", err)
	}
	if len(repo.deleted) != 0 {
		t.Errorf("rows deleted: %v", repo.deleted)
	}
}

func TestDeleteDocumentOfAnotherUserLeavesTheObject(t *testing.T) {
	repo := &fakeRepo{doc: store.DocumentDocument{ID: uuid.New(), OwnerID: bob, ObjectKey: "id/a.md"}}
	objects := &deletingObjects{}
	if err := deleteDocument(t, asAlice(t), repo, objects); status.Code(err) != codes.NotFound {
		t.Errorf("err = %v, want NotFound", err)
	}
	if len(objects.deleted) != 0 {
		t.Errorf("objects deleted: %v", objects.deleted)
	}
}
