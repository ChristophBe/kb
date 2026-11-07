package server

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/modules/ingestion/service/internal/documents"
	"github.com/christoph/kb/modules/ingestion/service/internal/events"
	"github.com/christoph/kb/modules/ingestion/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
)

func firstOf[T any](details []any) (T, bool) {
	for _, d := range details {
		if t, ok := d.(T); ok {
			return t, true
		}
	}
	var zero T
	return zero, false
}

type fakeRepo struct {
	store.Querier
	jobs map[uuid.UUID]store.IngestionJob
}

func (f *fakeRepo) CreateJob(_ context.Context, p store.CreateJobParams) (store.IngestionJob, error) {
	j := store.IngestionJob{ID: p.ID, DocumentID: p.DocumentID, Filename: p.Filename, Status: p.Status, Run: 1}
	f.jobs[p.ID] = j
	return j, nil
}

func (f *fakeRepo) GetJob(_ context.Context, id uuid.UUID) (store.IngestionJob, error) {
	j, ok := f.jobs[id]
	if !ok {
		return j, pgx.ErrNoRows
	}
	return j, nil
}

func (f *fakeRepo) AdvanceJob(_ context.Context, p store.AdvanceJobParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.Run != p.Run || j.Status >= 4 || j.Status >= p.Status {
		return j, pgx.ErrNoRows
	}
	j.Status = p.Status
	f.jobs[p.ID] = j
	return j, nil
}

func (f *fakeRepo) ReprocessJob(_ context.Context, id uuid.UUID) (store.IngestionJob, error) {
	j, ok := f.jobs[id]
	if !ok || j.Status < 4 {
		return j, pgx.ErrNoRows
	}
	j.Status, j.Error, j.ChunkCount, j.Run = int16(ingestionv1.JobStatus_JOB_STATUS_QUEUED), "", 0, j.Run+1
	f.jobs[id] = j
	return j, nil
}

type fakeDocuments struct {
	documentv1.DocumentServiceClient
	statuses []documentv1.DocumentStatus
}

func (f *fakeDocuments) CreateDocument(_ context.Context, req *documentv1.CreateDocumentRequest, _ ...grpc.CallOption) (*documentv1.CreateDocumentResponse, error) {
	return &documentv1.CreateDocumentResponse{
		Document:  &documentv1.Document{Id: uuid.NewString(), Filename: req.GetFilename()},
		UploadUrl: "http://s3/upload",
	}, nil
}

func (f *fakeDocuments) SetDocumentStatus(_ context.Context, req *documentv1.SetDocumentStatusRequest, _ ...grpc.CallOption) (*documentv1.SetDocumentStatusResponse, error) {
	f.statuses = append(f.statuses, req.GetStatus())
	return &documentv1.SetDocumentStatusResponse{}, nil
}

type published struct {
	subject string
	msg     proto.Message
	id      string
}

type fakePublisher struct{ sent []published }

func (f *fakePublisher) Publish(_ context.Context, subject string, msg proto.Message, id string) error {
	f.sent = append(f.sent, published{subject, msg, id})
	return nil
}

func TestUploadFlowQueuesProcessingOnce(t *testing.T) {
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}
	docs := &fakeDocuments{}
	pub := &fakePublisher{}
	srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

	created, err := srv.CreateUpload(t.Context(), &ingestionv1.CreateUploadRequest{Filename: "a.md", SizeBytes: 3})
	if err != nil {
		t.Fatal(err)
	}
	if created.GetUploadUrl() == "" || created.GetJob().GetStatus() != ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD {
		t.Fatalf("unexpected create response: %v", created)
	}

	done, err := srv.CompleteUpload(t.Context(), &ingestionv1.CompleteUploadRequest{JobId: created.GetJob().GetId()})
	if err != nil {
		t.Fatal(err)
	}
	if done.GetJob().GetStatus() != ingestionv1.JobStatus_JOB_STATUS_QUEUED {
		t.Errorf("status = %v, want QUEUED", done.GetJob().GetStatus())
	}
	if len(pub.sent) != 1 || pub.sent[0].subject != events.SubjectUploaded {
		t.Fatalf("published = %v", pub.sent)
	}
	if ev := pub.sent[0].msg.(*ingestionv1.DocumentUploaded); ev.GetJobId() != created.GetJob().GetId() {
		t.Errorf("event job id = %q", ev.GetJobId())
	}
	if len(docs.statuses) != 1 || docs.statuses[0] != documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED {
		t.Errorf("document statuses = %v", docs.statuses)
	}

	_, err = srv.CompleteUpload(t.Context(), &ingestionv1.CompleteUploadRequest{JobId: created.GetJob().GetId()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Errorf("second complete: err = %v, want FailedPrecondition", err)
	}
	if len(pub.sent) != 1 {
		t.Errorf("event published twice")
	}
}

// peerFailure fails SetDocumentStatus with a status from the document module.
type peerFailure struct {
	fakeDocuments
	err error
}

func (f *peerFailure) SetDocumentStatus(context.Context, *documentv1.SetDocumentStatusRequest, ...grpc.CallOption) (*documentv1.SetDocumentStatusResponse, error) {
	return nil, f.err
}

func TestCompleteUploadMapsPeerErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		peer codes.Code
		want codes.Code
	}{
		{"peer down", codes.Unavailable, codes.Unavailable},
		{"peer too slow", codes.DeadlineExceeded, codes.Unavailable},
		{"file missing", codes.FailedPrecondition, codes.FailedPrecondition},
		{"peer not found is not our not found", codes.NotFound, codes.Internal},
		{"peer internal", codes.Internal, codes.Internal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := uuid.New()
			repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{
				id: {ID: id, DocumentID: uuid.New(), Status: int16(ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD)},
			}}
			docs := &peerFailure{err: status.Error(tc.peer, "peer detail")}
			pub := &fakePublisher{}
			srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

			_, err := srv.CompleteUpload(t.Context(), &ingestionv1.CompleteUploadRequest{JobId: id.String()})
			if status.Code(err) != tc.want {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if strings.Contains(status.Convert(err).Message(), "peer detail") {
				t.Errorf("peer message leaked: %v", err)
			}
			if repo.jobs[id].Status != int16(ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD) || len(pub.sent) != 0 {
				t.Errorf("job moved on: %+v, published %v", repo.jobs[id], pub.sent)
			}
		})
	}
}

func TestCreateUploadValidates(t *testing.T) {
	srv := New(app.New(store.NewJobs(&fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	for _, tc := range []struct {
		name   string
		req    *ingestionv1.CreateUploadRequest
		fields []string
	}{
		{"no filename", &ingestionv1.CreateUploadRequest{SizeBytes: 3}, []string{"filename"}},
		{"empty file", &ingestionv1.CreateUploadRequest{Filename: "a.md"}, []string{"size_bytes"}},
		{"both", &ingestionv1.CreateUploadRequest{SizeBytes: -1}, []string{"filename", "size_bytes"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := srv.CreateUpload(t.Context(), tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("err = %v, want InvalidArgument", err)
			}
			var fields []string
			for _, v := range grpcserver.FieldViolations(err) {
				fields = append(fields, v.GetField())
			}
			if !slices.Equal(fields, tc.fields) {
				t.Errorf("fields %v, want %v", fields, tc.fields)
			}
		})
	}
}

func TestUnknownAndInvalidJobs(t *testing.T) {
	srv := New(app.New(store.NewJobs(&fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	_, err := srv.GetJob(t.Context(), &ingestionv1.GetJobRequest{Id: uuid.NewString()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("unknown: %v", err)
	}
	_, err = srv.CompleteUpload(t.Context(), &ingestionv1.CompleteUploadRequest{JobId: "nope"})
	if v := grpcserver.FieldViolations(err); status.Code(err) != codes.InvalidArgument || len(v) != 1 || v[0].GetField() != "job_id" {
		t.Errorf("invalid: %v, violations %v", err, v)
	}
}

func TestReprocessJob(t *testing.T) {
	ids := map[ingestionv1.JobStatus]uuid.UUID{}
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}
	for _, st := range []ingestionv1.JobStatus{
		ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD, ingestionv1.JobStatus_JOB_STATUS_QUEUED,
		ingestionv1.JobStatus_JOB_STATUS_PROCESSING, ingestionv1.JobStatus_JOB_STATUS_DONE,
		ingestionv1.JobStatus_JOB_STATUS_FAILED,
	} {
		id := uuid.New()
		ids[st] = id
		repo.jobs[id] = store.IngestionJob{ID: id, DocumentID: uuid.New(), Status: int16(st), Error: "no text", ChunkCount: 4, Run: 1}
	}
	pub := &fakePublisher{}
	srv := New(app.New(store.NewJobs(repo), documents.New(&fakeDocuments{}), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

	for _, tc := range []struct {
		name string
		id   string
		want codes.Code
	}{
		{"pending upload", ids[ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD].String(), codes.FailedPrecondition},
		{"queued", ids[ingestionv1.JobStatus_JOB_STATUS_QUEUED].String(), codes.FailedPrecondition},
		{"processing", ids[ingestionv1.JobStatus_JOB_STATUS_PROCESSING].String(), codes.FailedPrecondition},
		{"unknown", uuid.NewString(), codes.NotFound},
		{"malformed", "nope", codes.InvalidArgument},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := srv.ReprocessJob(t.Context(), &ingestionv1.ReprocessJobRequest{Id: tc.id})
			if status.Code(err) != tc.want {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if tc.want == codes.FailedPrecondition {
				details := status.Convert(err).Details()
				if info, ok := firstOf[*errdetails.ErrorInfo](details); !ok || info.GetReason() != "JOB_NOT_REPROCESSABLE" || info.GetDomain() != "kb.ingestion.v1" {
					t.Errorf("details = %v, want ErrorInfo JOB_NOT_REPROCESSABLE", details)
				}
			}
		})
	}
	if len(pub.sent) != 0 {
		t.Fatalf("published = %v", pub.sent)
	}

	for i, st := range []ingestionv1.JobStatus{ingestionv1.JobStatus_JOB_STATUS_FAILED, ingestionv1.JobStatus_JOB_STATUS_DONE} {
		t.Run(st.String(), func(t *testing.T) {
			id := ids[st]
			resp, err := srv.ReprocessJob(t.Context(), &ingestionv1.ReprocessJobRequest{Id: id.String()})
			if err != nil {
				t.Fatal(err)
			}
			if job := resp.GetJob(); job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_QUEUED || job.GetError() != "" || job.GetChunkCount() != 0 {
				t.Errorf("job = %v", job)
			}
			if len(pub.sent) != i+1 {
				t.Fatalf("published = %v", pub.sent)
			}
			sent := pub.sent[i]
			ev, ok := sent.msg.(*ingestionv1.DocumentUploaded)
			if sent.subject != events.SubjectUploaded || !ok || ev.GetJobId() != id.String() || ev.GetRun() != 2 {
				t.Errorf("published %q %v", sent.subject, sent.msg)
			}
			// A fresh message id per run: JetStream would drop a repeated one.
			if sent.id != id.String()+":2" {
				t.Errorf("message id = %q", sent.id)
			}
		})
	}
}
