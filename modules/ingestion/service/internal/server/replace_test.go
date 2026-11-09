package server

import (
	"context"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/modules/ingestion/service/internal/documents"
	"github.com/christoph/kb/modules/ingestion/service/internal/events"
	"github.com/christoph/kb/modules/ingestion/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
)

func (f *fakeRepo) GetDocumentJob(_ context.Context, p store.GetDocumentJobParams) (store.IngestionJob, error) {
	for _, j := range f.jobs {
		if j.DocumentID == p.DocumentID && j.OwnerID == p.OwnerID {
			return j, nil
		}
	}
	return store.IngestionJob{}, pgx.ErrNoRows
}

func (f *fakeRepo) RestartJob(_ context.Context, p store.RestartJobParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.OwnerID != p.OwnerID || j.Status == 2 || j.Status == 3 {
		return store.IngestionJob{}, pgx.ErrNoRows
	}
	j.Status, j.Filename, j.ContentType, j.Error, j.ChunkCount, j.Run = 1, p.Filename, p.ContentType, "", 0, j.Run+1
	f.jobs[p.ID] = j
	return j, nil
}

// replacingDocuments answers ReplaceContent like the document module, or
// fails with err.
type replacingDocuments struct {
	fakeDocuments
	err      error
	replaced []*documentv1.ReplaceContentRequest
}

func (f *replacingDocuments) ReplaceContent(_ context.Context, req *documentv1.ReplaceContentRequest, _ ...grpc.CallOption) (*documentv1.ReplaceContentResponse, error) {
	f.replaced = append(f.replaced, req)
	if f.err != nil {
		return nil, f.err
	}
	return &documentv1.ReplaceContentResponse{
		Document: &documentv1.Document{Id: req.GetId(), Filename: "old.md", PendingVersion: &documentv1.PendingVersion{
			Version: 2, Filename: req.GetFilename(), ContentType: "text/markdown",
		}},
		UploadUrl: "http://s3/v2",
	}, nil
}

func doneJobFor(t *testing.T) (*fakeRepo, store.IngestionJob) {
	t.Helper()
	job := store.IngestionJob{
		ID: uuid.New(), OwnerID: alice, DocumentID: uuid.New(), Filename: "old.md",
		Status: int16(ingestionv1.JobStatus_JOB_STATUS_DONE), Run: 1, ChunkCount: 3,
	}
	return &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{job.ID: job}}, job
}

func TestReplaceUploadFlowProcessesTheNewVersion(t *testing.T) {
	repo, old := doneJobFor(t)
	docs := &replacingDocuments{}
	pub := &fakePublisher{}
	srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

	replaced, err := srv.ReplaceUpload(as(t, alice), &ingestionv1.ReplaceUploadRequest{
		DocumentId: old.DocumentID.String(), Filename: "new.md", SizeBytes: 3, Sha256: "abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	job := replaced.GetJob()
	if job.GetId() != old.ID.String() || job.GetDocumentId() != old.DocumentID.String() || job.GetFilename() != "new.md" ||
		job.GetContentType() != "text/markdown" || job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD ||
		replaced.GetUploadUrl() != "http://s3/v2" {
		t.Fatalf("response = %v", replaced)
	}
	if r := docs.replaced[0]; r.GetId() != old.DocumentID.String() || r.GetSha256() != "abc" || r.GetSizeBytes() != 3 {
		t.Errorf("ReplaceContent request = %v", r)
	}

	if _, err := srv.CompleteUpload(as(t, alice), &ingestionv1.CompleteUploadRequest{JobId: job.GetId()}); err != nil {
		t.Fatal(err)
	}
	if len(pub.sent) != 1 {
		t.Fatalf("published = %v", pub.sent)
	}
	ev := pub.sent[0].msg.(*ingestionv1.DocumentUploaded)
	if ev.GetRun() != 2 || ev.GetFilename() != "new.md" || ev.GetDocumentId() != old.DocumentID.String() || pub.sent[0].id != old.ID.String()+":2" {
		t.Errorf("event = %v, id %q", ev, pub.sent[0].id)
	}
}

func TestReplaceUploadValidates(t *testing.T) {
	repo, old := doneJobFor(t)
	docs := &replacingDocuments{}
	srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	_, err := srv.ReplaceUpload(as(t, alice), &ingestionv1.ReplaceUploadRequest{DocumentId: "nope"})
	fields := map[string]bool{}
	for _, v := range grpcserver.FieldViolations(err) {
		fields[v.GetField()] = true
	}
	if status.Code(err) != codes.InvalidArgument || !fields["document_id"] || !fields["filename"] || !fields["size_bytes"] {
		t.Errorf("err = %v, fields %v", err, fields)
	}
	if len(docs.replaced) != 0 || repo.jobs[old.ID].Run != 1 {
		t.Error("an invalid request reached the document module")
	}
}

func TestReplaceUploadMapsTheDocumentModulesAnswers(t *testing.T) {
	for _, tc := range []struct {
		name   string
		peer   error
		want   codes.Code
		reason string
		field  string
	}{
		{"another user's or unknown", status.Error(codes.NotFound, "document not found"), codes.NotFound, "", ""},
		{"busy", grpcserver.WithDetails(codes.FailedPrecondition, "busy", grpcserver.ErrorInfo("kb.document.v1", "DOCUMENT_BUSY", nil)), codes.FailedPrecondition, "DOCUMENT_BUSY", ""},
		{"file not accepted", grpcserver.InvalidArgument(grpcserver.Violation("size_bytes", "The file is larger than the limit of 50 MiB")), codes.InvalidArgument, "", "size_bytes"},
		{"peer down", status.Error(codes.Unavailable, "down"), codes.Unavailable, "", ""},
		{"peer internal", status.Error(codes.Internal, "boom"), codes.Internal, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo, old := doneJobFor(t)
			srv := New(app.New(store.NewJobs(repo), documents.New(&replacingDocuments{err: tc.peer}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
			_, err := srv.ReplaceUpload(as(t, alice), &ingestionv1.ReplaceUploadRequest{DocumentId: old.DocumentID.String(), Filename: "b.md", SizeBytes: 3})
			if status.Code(err) != tc.want {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if tc.reason != "" {
				info, _ := firstOf[*errdetails.ErrorInfo](status.Convert(err).Details())
				if info.GetReason() != tc.reason || info.GetDomain() != "kb.ingestion.v1" {
					t.Errorf("error info = %v", info)
				}
			}
			if tc.field != "" {
				if v := grpcserver.FieldViolations(err); len(v) != 1 || v[0].GetField() != tc.field {
					t.Errorf("violations = %v", v)
				}
			}
			if repo.jobs[old.ID].Run != 1 || repo.jobs[old.ID].Status != old.Status {
				t.Errorf("the job changed: %+v", repo.jobs[old.ID])
			}
		})
	}
}

func TestReplaceUploadRequiresAUser(t *testing.T) {
	repo, old := doneJobFor(t)
	docs := &replacingDocuments{}
	srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	_, err := srv.ReplaceUpload(t.Context(), &ingestionv1.ReplaceUploadRequest{DocumentId: old.DocumentID.String(), Filename: "b.md", SizeBytes: 3})
	if status.Code(err) != codes.Unauthenticated || len(docs.replaced) != 0 {
		t.Errorf("err = %v, replaced %v", err, docs.replaced)
	}
}
