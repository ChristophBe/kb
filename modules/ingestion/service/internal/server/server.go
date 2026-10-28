// Package server implements kb.ingestion.v1.IngestionService.
package server

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/events"
	"github.com/christoph/kb/modules/ingestion/service/internal/store"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

// Publisher publishes module events.
type Publisher interface {
	Publish(ctx context.Context, subject string, msg proto.Message, msgID string) error
}

type Server struct {
	ingestionv1.UnimplementedIngestionServiceServer
	repo      store.Querier
	documents documentv1.DocumentServiceClient
	publisher Publisher
	log       *slog.Logger
	// PollInterval controls how often WatchJob checks for changes.
	PollInterval time.Duration
}

func New(repo store.Querier, documents documentv1.DocumentServiceClient, publisher Publisher, log *slog.Logger) *Server {
	return &Server{repo: repo, documents: documents, publisher: publisher, log: log, PollInterval: 500 * time.Millisecond}
}

func (s *Server) CreateUpload(ctx context.Context, req *ingestionv1.CreateUploadRequest) (*ingestionv1.CreateUploadResponse, error) {
	if req.GetFilename() == "" {
		return nil, status.Error(codes.InvalidArgument, "filename is required")
	}
	created, err := s.documents.CreateDocument(ctx, &documentv1.CreateDocumentRequest{
		Title:       req.GetTitle(),
		Filename:    req.GetFilename(),
		ContentType: req.GetContentType(),
		SizeBytes:   req.GetSizeBytes(),
	})
	if err != nil {
		return nil, err
	}
	doc := created.GetDocument()
	job, err := s.repo.CreateJob(ctx, store.CreateJobParams{
		ID:          uuid.New(),
		DocumentID:  uuid.MustParse(doc.GetId()),
		Filename:    doc.GetFilename(),
		ContentType: doc.GetContentType(),
		Status:      int16(ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD),
	})
	if err != nil {
		return nil, s.internal("create job", err)
	}
	return &ingestionv1.CreateUploadResponse{Job: toProto(job), UploadUrl: created.GetUploadUrl()}, nil
}

func (s *Server) CompleteUpload(ctx context.Context, req *ingestionv1.CompleteUploadRequest) (*ingestionv1.CompleteUploadResponse, error) {
	job, err := s.getJob(ctx, req.GetJobId())
	if err != nil {
		return nil, err
	}
	if ingestionv1.JobStatus(job.Status) != ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD {
		return nil, status.Error(codes.FailedPrecondition, "upload already completed")
	}
	if _, err := s.documents.SetDocumentStatus(ctx, &documentv1.SetDocumentStatusRequest{
		Id: job.DocumentID.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED,
	}); err != nil {
		return nil, err
	}
	job, err = s.repo.AdvanceJob(ctx, store.AdvanceJobParams{
		ID: job.ID, Status: int16(ingestionv1.JobStatus_JOB_STATUS_QUEUED),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, status.Error(codes.FailedPrecondition, "upload already completed")
	}
	if err != nil {
		return nil, s.internal("queue job", err)
	}
	event := &ingestionv1.DocumentUploaded{
		JobId:       job.ID.String(),
		DocumentId:  job.DocumentID.String(),
		Filename:    job.Filename,
		ContentType: job.ContentType,
	}
	if err := s.publisher.Publish(ctx, events.SubjectUploaded, event, job.ID.String()); err != nil {
		return nil, s.internal("publish upload event", err)
	}
	return &ingestionv1.CompleteUploadResponse{Job: toProto(job)}, nil
}

func (s *Server) GetJob(ctx context.Context, req *ingestionv1.GetJobRequest) (*ingestionv1.GetJobResponse, error) {
	job, err := s.getJob(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	return &ingestionv1.GetJobResponse{Job: toProto(job)}, nil
}

func (s *Server) ListJobs(ctx context.Context, req *ingestionv1.ListJobsRequest) (*ingestionv1.ListJobsResponse, error) {
	limit := req.GetPage().GetPageSize()
	if limit <= 0 {
		limit = defaultPageSize
	}
	limit = min(limit, maxPageSize)
	var offset int32
	if tok := req.GetPage().GetPageToken(); tok != "" {
		o, err := strconv.Atoi(tok)
		if err != nil || o < 0 {
			return nil, status.Error(codes.InvalidArgument, "invalid page token")
		}
		offset = int32(o)
	}
	jobs, err := s.repo.ListJobs(ctx, store.ListJobsParams{Limit: limit + 1, Offset: offset})
	if err != nil {
		return nil, s.internal("list jobs", err)
	}
	resp := &ingestionv1.ListJobsResponse{Page: &commonv1.PageResponse{}}
	if len(jobs) > int(limit) {
		jobs = jobs[:limit]
		resp.Page.NextPageToken = strconv.Itoa(int(offset + limit))
	}
	for _, j := range jobs {
		resp.Jobs = append(resp.Jobs, toProto(j))
	}
	return resp, nil
}

func (s *Server) WatchJob(req *ingestionv1.WatchJobRequest, stream ingestionv1.IngestionService_WatchJobServer) error {
	ctx := stream.Context()
	ticker := time.NewTicker(s.PollInterval)
	defer ticker.Stop()
	var last time.Time
	for {
		job, err := s.getJob(ctx, req.GetId())
		if err != nil {
			return err
		}
		if !job.UpdatedAt.Time.Equal(last) {
			last = job.UpdatedAt.Time
			if err := stream.Send(&ingestionv1.WatchJobResponse{Job: toProto(job)}); err != nil {
				return err
			}
		}
		if isTerminal(job.Status) {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (s *Server) getJob(ctx context.Context, raw string) (store.IngestionJob, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return store.IngestionJob{}, status.Errorf(codes.InvalidArgument, "invalid job id %q", raw)
	}
	job, err := s.repo.GetJob(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.IngestionJob{}, status.Error(codes.NotFound, "job not found")
	}
	if err != nil {
		return store.IngestionJob{}, s.internal("get job", err)
	}
	return job, nil
}

func (s *Server) internal(op string, err error) error {
	s.log.Error(op, "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}

func isTerminal(st int16) bool {
	return st == int16(ingestionv1.JobStatus_JOB_STATUS_DONE) || st == int16(ingestionv1.JobStatus_JOB_STATUS_FAILED)
}

func toProto(j store.IngestionJob) *ingestionv1.Job {
	return &ingestionv1.Job{
		Id:          j.ID.String(),
		DocumentId:  j.DocumentID.String(),
		Filename:    j.Filename,
		ContentType: j.ContentType,
		Status:      ingestionv1.JobStatus(j.Status),
		Error:       j.Error,
		ChunkCount:  j.ChunkCount,
		CreateTime:  timestamppb.New(j.CreatedAt.Time),
		UpdateTime:  timestamppb.New(j.UpdatedAt.Time),
	}
}
