// Package app holds the ingestion use cases: creating and completing uploads
// and moving jobs through their states. It declares the ports it needs;
// transport maps its errors to gRPC statuses.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
)

var (
	// ErrNotFound means the job does not exist.
	ErrNotFound = errors.New("job not found")
	// ErrAlreadyCompleted means the upload of this job was completed before.
	ErrAlreadyCompleted = errors.New("upload already completed")
	// ErrUploadMissing means the document module has no uploaded file for the job.
	ErrUploadMissing = errors.New("the file has not been uploaded")
	// ErrDocumentsUnavailable means the document module cannot be reached right now.
	ErrDocumentsUnavailable = errors.New("the document service is unavailable")
	// ErrNotReprocessable means the job is not FAILED or DONE.
	ErrNotReprocessable = errors.New("only failed or done jobs can be reprocessed")
	// ErrNotAdvanced is returned by Jobs.Advance when the transition does not
	// apply: the job is unknown, terminal, in another run or already past the
	// requested status. Jobs.Reprocess returns it when the job is unknown or
	// not terminal.
	ErrNotAdvanced = errors.New("job not advanced")
)

// Job is one document's way through ingestion.
type Job struct {
	ID          uuid.UUID
	DocumentID  uuid.UUID
	Filename    string
	ContentType string
	Status      ingestionv1.JobStatus
	Error       string
	ChunkCount  int32
	// Run counts the processing runs: 1 for the upload, incremented by every
	// reprocess. Events name the run they belong to.
	Run int32
	// Stage and Progress (0–100) describe how far the current run got.
	Stage     ingestionv1.JobStage
	Progress  int32
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Terminal reports whether the job can no longer change.
func (j Job) Terminal() bool {
	return j.Status == ingestionv1.JobStatus_JOB_STATUS_DONE || j.Status == ingestionv1.JobStatus_JOB_STATUS_FAILED
}

// Transition moves a job to Status within run Run, recording Error and
// ChunkCount. Jobs only ever move forward; Jobs.Reprocess is the one way back.
type Transition struct {
	ID         uuid.UUID
	Run        int32
	Status     ingestionv1.JobStatus
	Error      string
	ChunkCount int32
}

// Progress reports how far run Run of a job got. Stage and Progress only
// grow within a run.
type Progress struct {
	ID       uuid.UUID
	Run      int32
	Stage    ingestionv1.JobStage
	Progress int32
}

// Jobs persists jobs. Get returns ErrNotFound for an unknown job, Advance
// returns ErrNotAdvanced when the transition does not apply. ReportProgress
// records progress of a QUEUED or PROCESSING job's current run (making it
// PROCESSING) and returns ErrNotAdvanced when the job is in another state or
// run, or already further. Reprocess queues a FAILED or DONE job again as its
// next run, and returns ErrNotAdvanced for any other job.
type Jobs interface {
	Create(ctx context.Context, job Job) (Job, error)
	Get(ctx context.Context, id uuid.UUID) (Job, error)
	List(ctx context.Context, limit, offset int32) ([]Job, error)
	Advance(ctx context.Context, t Transition) (Job, error)
	ReportProgress(ctx context.Context, p Progress) (Job, error)
	Reprocess(ctx context.Context, id uuid.UUID) (Job, error)
}

// NewUpload describes a file about to be uploaded.
type NewUpload struct {
	Title       string
	Filename    string
	ContentType string
	SizeBytes   int64
}

// Document is what ingestion knows about a document of the document module.
type Document struct {
	ID          uuid.UUID
	Filename    string
	ContentType string
	UploadURL   string
}

// Documents is the document module. It returns ErrDocumentsUnavailable while
// the module is unreachable, and MarkUploaded returns ErrUploadMissing when
// the file is not there.
type Documents interface {
	Create(ctx context.Context, upload NewUpload) (Document, error)
	MarkUploaded(ctx context.Context, id uuid.UUID) error
}

// Publisher announces jobs to the worker, once per run.
type Publisher interface {
	PublishUploaded(ctx context.Context, job Job) error
}

// Service implements the use cases on top of its ports.
type Service struct {
	jobs      Jobs
	documents Documents
	publisher Publisher
}

func New(jobs Jobs, documents Documents, publisher Publisher) *Service {
	return &Service{jobs: jobs, documents: documents, publisher: publisher}
}

// CreateUpload registers the document and a job waiting for its file. It
// returns the job and the URL to upload the file to.
func (s *Service) CreateUpload(ctx context.Context, upload NewUpload) (Job, string, error) {
	doc, err := s.documents.Create(ctx, upload)
	if err != nil {
		return Job{}, "", err
	}
	job, err := s.jobs.Create(ctx, Job{
		ID:          uuid.New(),
		DocumentID:  doc.ID,
		Filename:    doc.Filename,
		ContentType: doc.ContentType,
		Status:      ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD,
	})
	if err != nil {
		return Job{}, "", fmt.Errorf("create job: %w", err)
	}
	return job, doc.UploadURL, nil
}

// CompleteUpload queues a job once its file has arrived.
func (s *Service) CompleteUpload(ctx context.Context, id uuid.UUID) (Job, error) {
	job, err := s.jobs.Get(ctx, id)
	if err != nil {
		return Job{}, err
	}
	if job.Status != ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD {
		return Job{}, ErrAlreadyCompleted
	}
	if err := s.documents.MarkUploaded(ctx, job.DocumentID); err != nil {
		return Job{}, err
	}
	job, err = s.jobs.Advance(ctx, Transition{ID: id, Run: job.Run, Status: ingestionv1.JobStatus_JOB_STATUS_QUEUED})
	if errors.Is(err, ErrNotAdvanced) {
		return Job{}, ErrAlreadyCompleted
	}
	if err != nil {
		return Job{}, fmt.Errorf("queue job: %w", err)
	}
	if err := s.publisher.PublishUploaded(ctx, job); err != nil {
		return Job{}, fmt.Errorf("publish upload event: %w", err)
	}
	return job, nil
}

// ReprocessJob queues a FAILED or DONE job again as a new run. The worker
// replaces the document's chunks, so they are not duplicated.
func (s *Service) ReprocessJob(ctx context.Context, id uuid.UUID) (Job, error) {
	job, err := s.jobs.Reprocess(ctx, id)
	if errors.Is(err, ErrNotAdvanced) {
		if _, err := s.jobs.Get(ctx, id); err != nil {
			return Job{}, err
		}
		return Job{}, ErrNotReprocessable
	}
	if err != nil {
		return Job{}, fmt.Errorf("reprocess job: %w", err)
	}
	if err := s.publisher.PublishUploaded(ctx, job); err != nil {
		// Without the event the job would stay queued for good, and a queued
		// job can't be reprocessed: fail it so that it can be retried.
		_ = s.apply(ctx, Transition{
			ID: id, Run: job.Run, Status: ingestionv1.JobStatus_JOB_STATUS_FAILED,
			Error: "could not queue the job, try again",
		})
		return Job{}, fmt.Errorf("publish upload event: %w", err)
	}
	return job, nil
}

// GetJob returns one job.
func (s *Service) GetJob(ctx context.Context, id uuid.UUID) (Job, error) {
	return s.jobs.Get(ctx, id)
}

// ListJobs returns a page of jobs, newest first.
func (s *Service) ListJobs(ctx context.Context, limit, offset int32) ([]Job, error) {
	return s.jobs.List(ctx, limit, offset)
}

// ApplyStarted records that the worker picked up run run of a job.
func (s *Service) ApplyStarted(ctx context.Context, id uuid.UUID, run int32) error {
	return s.apply(ctx, Transition{ID: id, Run: run, Status: ingestionv1.JobStatus_JOB_STATUS_PROCESSING})
}

// ApplyProgress records the stage and progress the worker reported for run
// run of a job. Progress outside 0–100 is clamped.
func (s *Service) ApplyProgress(ctx context.Context, id uuid.UUID, run int32, stage ingestionv1.JobStage, progress int32) error {
	if run == 0 {
		run = 1
	}
	p := Progress{ID: id, Run: run, Stage: stage, Progress: min(max(progress, 0), 100)}
	if _, err := s.jobs.ReportProgress(ctx, p); err != nil && !errors.Is(err, ErrNotAdvanced) {
		return err
	}
	return nil
}

// ApplyProcessed records that the worker finished run run of a job.
func (s *Service) ApplyProcessed(ctx context.Context, id uuid.UUID, run, chunkCount int32) error {
	return s.apply(ctx, Transition{
		ID: id, Run: run, Status: ingestionv1.JobStatus_JOB_STATUS_DONE, ChunkCount: chunkCount,
	})
}

// ApplyFailed records that the worker gave up on run run of a job.
func (s *Service) ApplyFailed(ctx context.Context, id uuid.UUID, run int32, reason string) error {
	return s.apply(ctx, Transition{ID: id, Run: run, Status: ingestionv1.JobStatus_JOB_STATUS_FAILED, Error: reason})
}

// apply ignores transitions that don't apply: delivery is at-least-once, so
// stale and duplicate events are normal. Run 0 comes from events published
// before jobs had runs and means the first run.
func (s *Service) apply(ctx context.Context, t Transition) error {
	if t.Run == 0 {
		t.Run = 1
	}
	if _, err := s.jobs.Advance(ctx, t); err != nil && !errors.Is(err, ErrNotAdvanced) {
		return err
	}
	return nil
}
