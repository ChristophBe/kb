// Package server implements kb.ingestion.v1.IngestionService.
package server

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

type Server struct {
	ingestionv1.UnimplementedIngestionServiceServer
	app *app.Service
	log *slog.Logger
	// PollInterval controls how often WatchJob checks for changes.
	PollInterval time.Duration
}

func New(service *app.Service, log *slog.Logger) *Server {
	return &Server{app: service, log: log, PollInterval: 500 * time.Millisecond}
}

func (s *Server) CreateUpload(ctx context.Context, req *ingestionv1.CreateUploadRequest) (*ingestionv1.CreateUploadResponse, error) {
	if req.GetFilename() == "" {
		return nil, status.Error(codes.InvalidArgument, "filename is required")
	}
	job, uploadURL, err := s.app.CreateUpload(ctx, app.NewUpload{
		Title:       req.GetTitle(),
		Filename:    req.GetFilename(),
		ContentType: req.GetContentType(),
		SizeBytes:   req.GetSizeBytes(),
	})
	if err != nil {
		return nil, s.toStatus("create upload", err)
	}
	return &ingestionv1.CreateUploadResponse{Job: toProto(job), UploadUrl: uploadURL}, nil
}

func (s *Server) CompleteUpload(ctx context.Context, req *ingestionv1.CompleteUploadRequest) (*ingestionv1.CompleteUploadResponse, error) {
	id, err := parseID(req.GetJobId())
	if err != nil {
		return nil, err
	}
	job, err := s.app.CompleteUpload(ctx, id)
	if err != nil {
		return nil, s.toStatus("complete upload", err)
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
	jobs, err := s.app.ListJobs(ctx, limit+1, offset)
	if err != nil {
		return nil, s.toStatus("list jobs", err)
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
		if !job.UpdatedAt.Equal(last) {
			last = job.UpdatedAt
			if err := stream.Send(&ingestionv1.WatchJobResponse{Job: toProto(job)}); err != nil {
				return err
			}
		}
		if job.Terminal() {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (s *Server) ReprocessJob(ctx context.Context, req *ingestionv1.ReprocessJobRequest) (*ingestionv1.ReprocessJobResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	job, err := s.app.ReprocessJob(ctx, id)
	if err != nil {
		return nil, s.toStatus("reprocess job", err)
	}
	return &ingestionv1.ReprocessJobResponse{Job: toProto(job)}, nil
}

func (s *Server) getJob(ctx context.Context, raw string) (app.Job, error) {
	id, err := parseID(raw)
	if err != nil {
		return app.Job{}, err
	}
	job, err := s.app.GetJob(ctx, id)
	if err != nil {
		return app.Job{}, s.toStatus("get job", err)
	}
	return job, nil
}

func parseID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, status.Errorf(codes.InvalidArgument, "invalid job id %q", raw)
	}
	return id, nil
}

func (s *Server) toStatus(op string, err error) error {
	switch {
	case errors.Is(err, app.ErrNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, app.ErrAlreadyCompleted), errors.Is(err, app.ErrUploadMissing),
		errors.Is(err, app.ErrNotReprocessable):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, app.ErrDocumentsUnavailable):
		s.log.Warn(op, "error", err)
		return status.Error(codes.Unavailable, app.ErrDocumentsUnavailable.Error())
	}
	s.log.Error(op, "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}

func toProto(j app.Job) *ingestionv1.Job {
	return &ingestionv1.Job{
		Id:          j.ID.String(),
		DocumentId:  j.DocumentID.String(),
		Filename:    j.Filename,
		ContentType: j.ContentType,
		Status:      j.Status,
		Error:       j.Error,
		ChunkCount:  j.ChunkCount,
		CreateTime:  timestamppb.New(j.CreatedAt),
		UpdateTime:  timestamppb.New(j.UpdatedAt),
	}
}
