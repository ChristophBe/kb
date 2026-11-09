// Package server implements kb.ingestion.v1.IngestionService.
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
	"github.com/christoph/kb/platform/go/grpcserver"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	// domain is the ErrorInfo domain of this module's errors.
	domain = "kb.ingestion.v1"
)

// Server implements IngestionService. Jobs belong to the user who created the
// upload: every RPC acts on the calling user's jobs only and reports another
// user's as not found.
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
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	var violations []*errdetails.BadRequest_FieldViolation
	if req.GetFilename() == "" {
		violations = append(violations, grpcserver.Violation("filename", "A filename is required"))
	}
	if req.GetSizeBytes() <= 0 {
		// Nothing could be extracted from an empty file; it would only fail later.
		violations = append(violations, grpcserver.Violation("size_bytes", "The file is empty"))
	}
	if len(violations) > 0 {
		return nil, grpcserver.InvalidArgument(violations...)
	}
	job, uploadURL, err := s.app.CreateUpload(ctx, owner, app.NewUpload{
		Title:       req.GetTitle(),
		Filename:    req.GetFilename(),
		ContentType: req.GetContentType(),
		SizeBytes:   req.GetSizeBytes(),
		SHA256:      req.GetSha256(),
	})
	if err != nil {
		return nil, s.toStatus("create upload", err)
	}
	return &ingestionv1.CreateUploadResponse{Job: toProto(job), UploadUrl: uploadURL}, nil
}

// ReplaceUpload starts a new version of the calling user's document.
func (s *Server) ReplaceUpload(ctx context.Context, req *ingestionv1.ReplaceUploadRequest) (*ingestionv1.ReplaceUploadResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	var violations []*errdetails.BadRequest_FieldViolation
	documentID, err := uuid.Parse(req.GetDocumentId())
	if err != nil {
		violations = append(violations, grpcserver.Violation("document_id", fmt.Sprintf("Invalid document id %q", req.GetDocumentId())))
	}
	if req.GetFilename() == "" {
		violations = append(violations, grpcserver.Violation("filename", "A filename is required"))
	}
	if req.GetSizeBytes() <= 0 {
		violations = append(violations, grpcserver.Violation("size_bytes", "The file is empty"))
	}
	if len(violations) > 0 {
		return nil, grpcserver.InvalidArgument(violations...)
	}
	job, uploadURL, err := s.app.ReplaceUpload(ctx, owner, documentID, app.NewUpload{
		Filename:    req.GetFilename(),
		ContentType: req.GetContentType(),
		SizeBytes:   req.GetSizeBytes(),
		SHA256:      req.GetSha256(),
	})
	if err != nil {
		return nil, s.toStatus("replace upload", err)
	}
	return &ingestionv1.ReplaceUploadResponse{Job: toProto(job), UploadUrl: uploadURL}, nil
}

func (s *Server) CompleteUpload(ctx context.Context, req *ingestionv1.CompleteUploadRequest) (*ingestionv1.CompleteUploadResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("job_id", req.GetJobId())
	if err != nil {
		return nil, err
	}
	job, err := s.app.CompleteUpload(ctx, owner, id)
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
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	limit := req.GetPage().GetPageSize()
	if limit <= 0 {
		limit = defaultPageSize
	}
	limit = min(limit, maxPageSize)
	var offset int32
	if tok := req.GetPage().GetPageToken(); tok != "" {
		o, err := strconv.Atoi(tok)
		if err != nil || o < 0 {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation("page.page_token", "The page token is invalid"))
		}
		offset = int32(o)
	}
	jobs, err := s.app.ListJobs(ctx, owner, limit+1, offset)
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
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	job, err := s.app.ReprocessJob(ctx, owner, id)
	if err != nil {
		return nil, s.toStatus("reprocess job", err)
	}
	return &ingestionv1.ReprocessJobResponse{Job: toProto(job)}, nil
}

// getJob returns the calling user's job with the id in the request.
func (s *Server) getJob(ctx context.Context, raw string) (app.Job, error) {
	owner, err := caller(ctx)
	if err != nil {
		return app.Job{}, err
	}
	id, err := parseID("id", raw)
	if err != nil {
		return app.Job{}, err
	}
	job, err := s.app.GetJob(ctx, owner, id)
	if err != nil {
		return app.Job{}, s.toStatus("get job", err)
	}
	return job, nil
}

// caller returns the user the call is made for. Calls through the gateway
// always carry one.
func caller(ctx context.Context) (string, error) {
	user, ok := grpcserver.UserFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "the call has no user")
	}
	return user, nil
}

// parseID parses the job id in the request field named field.
func parseID(field, raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, grpcserver.InvalidArgument(grpcserver.Violation(field, fmt.Sprintf("Invalid job id %q", raw)))
	}
	return id, nil
}

func (s *Server) toStatus(op string, err error) error {
	var invalid *app.InvalidUploadError
	if errors.As(err, &invalid) {
		violations := make([]*errdetails.BadRequest_FieldViolation, 0, len(invalid.Violations))
		for _, v := range invalid.Violations {
			violations = append(violations, grpcserver.Violation(v.Field, v.Description))
		}
		return grpcserver.InvalidArgument(violations...)
	}
	switch {
	case errors.Is(err, app.ErrNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, app.ErrAlreadyCompleted):
		return failedPrecondition("UPLOAD_ALREADY_COMPLETED", app.ErrAlreadyCompleted)
	case errors.Is(err, app.ErrUploadMissing):
		return failedPrecondition("UPLOAD_MISSING", app.ErrUploadMissing)
	case errors.Is(err, app.ErrNotReprocessable):
		return failedPrecondition("JOB_NOT_REPROCESSABLE", app.ErrNotReprocessable)
	case errors.Is(err, app.ErrDocumentNotFound):
		return status.Error(codes.NotFound, app.ErrDocumentNotFound.Error())
	case errors.Is(err, app.ErrDocumentBusy):
		return failedPrecondition("DOCUMENT_BUSY", app.ErrDocumentBusy)
	case errors.Is(err, app.ErrDocumentsUnavailable):
		s.log.Warn(op, "error", err)
		return status.Error(codes.Unavailable, app.ErrDocumentsUnavailable.Error())
	}
	s.log.Error(op, "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}

// failedPrecondition reports a request in the wrong state, with a reason
// clients can branch on.
func failedPrecondition(reason string, err error) error {
	return grpcserver.WithDetails(codes.FailedPrecondition, err.Error(), grpcserver.ErrorInfo(domain, reason, nil))
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
		Progress:    j.Progress,
		Stage:       j.Stage,
		CreateTime:  timestamppb.New(j.CreatedAt),
		UpdateTime:  timestamppb.New(j.UpdatedAt),
		OwnerId:     j.OwnerID,
	}
}
