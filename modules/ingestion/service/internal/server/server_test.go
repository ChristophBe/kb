package server

import (
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
)

type fakeRepo struct {
	store.Querier
	jobs map[uuid.UUID]store.IngestionJob
}

func (f *fakeRepo) CreateJob(_ context.Context, p store.CreateJobParams) (store.IngestionJob, error) {
	j := store.IngestionJob{ID: p.ID, DocumentID: p.DocumentID, Filename: p.Filename, Status: p.Status}
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
	if !ok || j.Status >= 4 || j.Status >= p.Status {
		return j, pgx.ErrNoRows
	}
	j.Status = p.Status
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
}

type fakePublisher struct{ sent []published }

func (f *fakePublisher) Publish(_ context.Context, subject string, msg proto.Message, _ string) error {
	f.sent = append(f.sent, published{subject, msg})
	return nil
}

func TestUploadFlowQueuesProcessingOnce(t *testing.T) {
	repo := &fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}
	docs := &fakeDocuments{}
	pub := &fakePublisher{}
	srv := New(app.New(store.NewJobs(repo), documents.New(docs), events.NewPublisher(pub)), slog.New(slog.DiscardHandler))

	created, err := srv.CreateUpload(t.Context(), &ingestionv1.CreateUploadRequest{Filename: "a.md"})
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

func TestUnknownAndInvalidJobs(t *testing.T) {
	srv := New(app.New(store.NewJobs(&fakeRepo{jobs: map[uuid.UUID]store.IngestionJob{}}), documents.New(&fakeDocuments{}), events.NewPublisher(&fakePublisher{})), slog.New(slog.DiscardHandler))
	_, err := srv.GetJob(t.Context(), &ingestionv1.GetJobRequest{Id: uuid.NewString()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("unknown: %v", err)
	}
	_, err = srv.CompleteUpload(t.Context(), &ingestionv1.CompleteUploadRequest{JobId: "nope"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("invalid: %v", err)
	}
}
