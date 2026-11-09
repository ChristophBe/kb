package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
)

// Jobs implements app.Jobs on top of the generated queries.
type Jobs struct {
	q Querier
}

func NewJobs(q Querier) *Jobs {
	return &Jobs{q: q}
}

func (j *Jobs) Create(ctx context.Context, job app.Job) (app.Job, error) {
	row, err := j.q.CreateJob(ctx, CreateJobParams{
		ID:          job.ID,
		OwnerID:     job.OwnerID,
		DocumentID:  job.DocumentID,
		Filename:    job.Filename,
		ContentType: job.ContentType,
		Status:      int16(job.Status),
	})
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) Get(ctx context.Context, owner string, id uuid.UUID) (app.Job, error) {
	row, err := j.q.GetJob(ctx, GetJobParams{ID: id, OwnerID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotFound
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) GetByDocument(ctx context.Context, owner string, documentID uuid.UUID) (app.Job, error) {
	row, err := j.q.GetDocumentJob(ctx, GetDocumentJobParams{DocumentID: documentID, OwnerID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotFound
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) Restart(ctx context.Context, owner string, id uuid.UUID, filename, contentType string) (app.Job, error) {
	row, err := j.q.RestartJob(ctx, RestartJobParams{ID: id, OwnerID: owner, Filename: filename, ContentType: contentType})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotAdvanced
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) List(ctx context.Context, owner string, limit, offset int32) ([]app.Job, error) {
	rows, err := j.q.ListJobs(ctx, ListJobsParams{OwnerID: owner, Limit: limit, Offset: offset})
	if err != nil {
		return nil, err
	}
	jobs := make([]app.Job, 0, len(rows))
	for _, row := range rows {
		jobs = append(jobs, toJob(row))
	}
	return jobs, nil
}

func (j *Jobs) Advance(ctx context.Context, t app.Transition) (app.Job, error) {
	row, err := j.q.AdvanceJob(ctx, AdvanceJobParams{
		ID: t.ID, Run: t.Run, Status: int16(t.Status), Error: t.Error, ChunkCount: t.ChunkCount,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotAdvanced
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) ReportProgress(ctx context.Context, p app.Progress) (app.Job, error) {
	row, err := j.q.ReportProgress(ctx, ReportProgressParams{
		ID: p.ID, Run: p.Run, Stage: int16(p.Stage), Progress: int16(p.Progress),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotAdvanced
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) Reprocess(ctx context.Context, owner string, id uuid.UUID) (app.Job, error) {
	row, err := j.q.ReprocessJob(ctx, ReprocessJobParams{ID: id, OwnerID: owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotAdvanced
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func toJob(row IngestionJob) app.Job {
	return app.Job{
		ID:          row.ID,
		OwnerID:     row.OwnerID,
		DocumentID:  row.DocumentID,
		Filename:    row.Filename,
		ContentType: row.ContentType,
		Status:      ingestionv1.JobStatus(row.Status),
		Error:       row.Error,
		ChunkCount:  row.ChunkCount,
		Run:         row.Run,
		Stage:       ingestionv1.JobStage(row.Stage),
		Progress:    int32(row.Progress),
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
	}
}
