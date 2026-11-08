package server

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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

// alice and bob are two users; the tests call as alice unless they say otherwise.
const (
	alice = "alice"
	bob   = "bob"
)

// as returns the test's context carrying user, as the user interceptor would.
func as(t *testing.T, user string) context.Context {
	return grpcserver.WithUser(t.Context(), user)
}

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
	j := store.IngestionJob{ID: p.ID, OwnerID: p.OwnerID, DocumentID: p.DocumentID, Filename: p.Filename, Status: p.Status, Run: 1}
	f.jobs[p.ID] = j
	return j, nil
}

func (f *fakeRepo) GetJob(_ context.Context, p store.GetJobParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.OwnerID != p.OwnerID {
		return store.IngestionJob{}, pgx.ErrNoRows
	}
	return j, nil
}

// ListJobs returns the owner's jobs; the tests don't page.
func (f *fakeRepo) ListJobs(_ context.Context, p store.ListJobsParams) ([]store.IngestionJob, error) {
	var jobs []store.IngestionJob
	for _, j := range f.jobs {
		if j.OwnerID == p.OwnerID {
			jobs = append(jobs, j)
		}
	}
	return jobs, nil
}

func (f *fakeRepo) AdvanceJob(_ context.Context, p store.AdvanceJobParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.Run != p.Run || j.Status >= 4 || j.Status >= p.Status {
		return j, pgx.ErrNoRows
	}
	j.Status = p.Status
	if p.Status == 4 {
		j.Progress = 100
	}
	j.UpdatedAt = pgtype.Timestamptz{Time: j.UpdatedAt.Time.Add(time.Millisecond), Valid: true}
	f.jobs[p.ID] = j
	return j, nil
}

// ReportProgress mirrors the query: QUEUED or PROCESSING jobs of the run,
// forward only. It bumps updated_at, which WatchJob looks at.
func (f *fakeRepo) ReportProgress(_ context.Context, p store.ReportProgressParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.Run != p.Run || j.Status < 2 || j.Status > 3 || j.Stage > p.Stage || (j.Stage == p.Stage && j.Progress >= p.Progress) {
		return j, pgx.ErrNoRows
	}
	j.Status, j.Stage, j.Progress = 3, p.Stage, p.Progress
	j.UpdatedAt = pgtype.Timestamptz{Time: j.UpdatedAt.Time.Add(time.Millisecond), Valid: true}
	f.jobs[p.ID] = j
	return j, nil
}

func (f *fakeRepo) ReprocessJob(_ context.Context, p store.ReprocessJobParams) (store.IngestionJob, error) {
	j, ok := f.jobs[p.ID]
	if !ok || j.OwnerID != p.OwnerID || j.Status < 4 {
		return store.IngestionJob{}, pgx.ErrNoRows
	}
	j.Status, j.Error, j.ChunkCount, j.Run = int16(ingestionv1.JobStatus_JOB_STATUS_QUEUED), "", 0, j.Run+1
	f.jobs[p.ID] = j
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

	created, err := srv.CreateUpload(as(t, alice), &ingestionv1.CreateUploadRequest{Filename: "a.md", SizeBytes: 3})
	if err != nil {
		t.Fatal(err)
	}
	if created.GetUploadUrl() == "" || created.GetJob().GetStatus() != ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD {
		t.Fatalf("unexpected create response: %v", created)
	}

	done, err := srv.CompleteUpload(as(t, alice), &ingestionv1.CompleteUploadRequest{JobId: created.GetJob().GetId()})
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

	_, err = srv.CompleteUpload(as(t, alice), &ingestionv1.CompleteUploadRequest{JobId: created.GetJob().GetId()})
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
				id: {ID: id, OwnerID: alice, DocumentID: uuid.New(), Status: int16(ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD)},
			}}
			docs := &peerFailure{err: status.Error(tc.peer, "peer detail")}
			pub := &fakePublisher{}
			srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

			_, err := srv.CompleteUpload(as(t, alice), &ingestionv1.CompleteUploadRequest{JobId: id.String()})
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
			_, err := srv.CreateUpload(as(t, alice), tc.req)
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
	_, err := srv.GetJob(as(t, alice), &ingestionv1.GetJobRequest{Id: uuid.NewString()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("unknown: %v", err)
	}
	_, err = srv.CompleteUpload(as(t, alice), &ingestionv1.CompleteUploadRequest{JobId: "nope"})
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
		repo.jobs[id] = store.IngestionJob{ID: id, OwnerID: alice, DocumentID: uuid.New(), Status: int16(st), Error: "no text", ChunkCount: 4, Run: 1}
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
			_, err := srv.ReprocessJob(as(t, alice), &ingestionv1.ReprocessJobRequest{Id: tc.id})
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
			resp, err := srv.ReprocessJob(as(t, alice), &ingestionv1.ReprocessJobRequest{Id: id.String()})
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

// watchStream collects what WatchJob sends and calls onSend after each message.
type watchStream struct {
	grpc.ServerStream
	ctx    context.Context
	sent   []*ingestionv1.Job
	onSend func(*ingestionv1.Job)
}

func (w *watchStream) Context() context.Context { return w.ctx }

func (w *watchStream) Send(resp *ingestionv1.WatchJobResponse) error {
	w.sent = append(w.sent, resp.GetJob())
	w.onSend(resp.GetJob())
	return nil
}

func TestWatchJobStreamsProgressUntilDone(t *testing.T) {
	id := uuid.New()
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{
		id: {
			ID: id, OwnerID: alice, DocumentID: uuid.New(), Status: int16(ingestionv1.JobStatus_JOB_STATUS_PROCESSING), Run: 1,
			UpdatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		},
	}}
	service := app.New(store.NewJobs(repo), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{}))
	srv := New(service, slog.New(slog.DiscardHandler))
	srv.PollInterval = time.Millisecond

	embedding := ingestionv1.JobStage_JOB_STAGE_EMBEDDING
	// Every message the client sees, the worker gets one step further.
	steps := []func() error{
		func() error { return service.ApplyProgress(t.Context(), id, 1, embedding, 10) },
		func() error { return service.ApplyProgress(t.Context(), id, 1, embedding, 50) },
		func() error { return service.ApplyProcessed(t.Context(), id, 1, 8) },
	}
	stream := &watchStream{ctx: as(t, alice)}
	stream.onSend = func(*ingestionv1.Job) {
		if len(steps) > 0 {
			if err := steps[0](); err != nil {
				t.Error(err)
			}
			steps = steps[1:]
		}
	}
	if err := srv.WatchJob(&ingestionv1.WatchJobRequest{Id: id.String()}, stream); err != nil {
		t.Fatal(err)
	}

	type update struct {
		status   ingestionv1.JobStatus
		stage    ingestionv1.JobStage
		progress int32
	}
	var got []update
	for _, j := range stream.sent {
		got = append(got, update{j.GetStatus(), j.GetStage(), j.GetProgress()})
	}
	processing := ingestionv1.JobStatus_JOB_STATUS_PROCESSING
	want := []update{
		{processing, ingestionv1.JobStage_JOB_STAGE_UNSPECIFIED, 0},
		{processing, embedding, 10},
		{processing, embedding, 50},
		{ingestionv1.JobStatus_JOB_STATUS_DONE, embedding, 100},
	}
	if !slices.Equal(got, want) {
		t.Errorf("streamed %v, want %v", got, want)
	}
}

func TestCallsWithoutAUserAreUnauthenticated(t *testing.T) {
	id := uuid.New()
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{
		id: {ID: id, OwnerID: alice, DocumentID: uuid.New(), Status: int16(ingestionv1.JobStatus_JOB_STATUS_FAILED), Run: 1},
	}}
	srv := New(app.New(store.NewJobs(repo), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	ctx := t.Context()
	for name, call := range map[string]func() error{
		"CreateUpload": func() error {
			_, err := srv.CreateUpload(ctx, &ingestionv1.CreateUploadRequest{Filename: "a.md", SizeBytes: 3})
			return err
		},
		"CompleteUpload": func() error {
			_, err := srv.CompleteUpload(ctx, &ingestionv1.CompleteUploadRequest{JobId: id.String()})
			return err
		},
		"GetJob": func() error {
			_, err := srv.GetJob(ctx, &ingestionv1.GetJobRequest{Id: id.String()})
			return err
		},
		"ListJobs": func() error {
			_, err := srv.ListJobs(ctx, &ingestionv1.ListJobsRequest{})
			return err
		},
		"WatchJob": func() error {
			return srv.WatchJob(&ingestionv1.WatchJobRequest{Id: id.String()}, &watchStream{ctx: ctx, onSend: func(*ingestionv1.Job) {}})
		},
		"ReprocessJob": func() error {
			_, err := srv.ReprocessJob(ctx, &ingestionv1.ReprocessJobRequest{Id: id.String()})
			return err
		},
	} {
		if err := call(); status.Code(err) != codes.Unauthenticated {
			t.Errorf("%s: err = %v, want Unauthenticated", name, err)
		}
	}
	if repo.jobs[id].Run != 1 {
		t.Errorf("job reprocessed without a user: %+v", repo.jobs[id])
	}
}

func TestUsersOnlySeeTheirOwnJobs(t *testing.T) {
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}
	pub := &fakePublisher{}
	srv := New(app.New(store.NewJobs(repo), documents.New(&fakeDocuments{}), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))
	srv.PollInterval = time.Millisecond

	created, err := srv.CreateUpload(as(t, alice), &ingestionv1.CreateUploadRequest{Filename: "a.md", SizeBytes: 3})
	if err != nil {
		t.Fatal(err)
	}
	job := created.GetJob()
	if job.GetOwnerId() != alice {
		t.Fatalf("owner_id = %q, want %q", job.GetOwnerId(), alice)
	}

	// bob can't see, complete, watch or reprocess alice's job: it does not exist for him.
	if _, err := srv.GetJob(as(t, bob), &ingestionv1.GetJobRequest{Id: job.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("get: err = %v, want NotFound", err)
	}
	if _, err := srv.CompleteUpload(as(t, bob), &ingestionv1.CompleteUploadRequest{JobId: job.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("complete: err = %v, want NotFound", err)
	}
	stream := &watchStream{ctx: as(t, bob), onSend: func(*ingestionv1.Job) {}}
	if err := srv.WatchJob(&ingestionv1.WatchJobRequest{Id: job.GetId()}, stream); status.Code(err) != codes.NotFound || len(stream.sent) != 0 {
		t.Errorf("watch: err = %v, sent %v, want NotFound", err, stream.sent)
	}
	list, err := srv.ListJobs(as(t, bob), &ingestionv1.ListJobsRequest{})
	if err != nil || len(list.GetJobs()) != 0 {
		t.Errorf("bob's list = %v, %v; want empty", list.GetJobs(), err)
	}
	id := uuid.MustParse(job.GetId())
	failedJob := repo.jobs[id]
	failedJob.Status = int16(ingestionv1.JobStatus_JOB_STATUS_FAILED)
	repo.jobs[id] = failedJob
	if _, err := srv.ReprocessJob(as(t, bob), &ingestionv1.ReprocessJobRequest{Id: job.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("reprocess: err = %v, want NotFound", err)
	}
	if got := repo.jobs[id]; got.Run != 1 || len(pub.sent) != 0 {
		t.Errorf("bob changed alice's job: %+v, published %v", got, pub.sent)
	}

	// alice still sees and controls it.
	list, err = srv.ListJobs(as(t, alice), &ingestionv1.ListJobsRequest{})
	if err != nil || len(list.GetJobs()) != 1 || list.GetJobs()[0].GetId() != job.GetId() {
		t.Errorf("alice's list = %v, %v", list.GetJobs(), err)
	}
	if _, err := srv.ReprocessJob(as(t, alice), &ingestionv1.ReprocessJobRequest{Id: job.GetId()}); err != nil {
		t.Errorf("alice reprocess: %v", err)
	}
}
