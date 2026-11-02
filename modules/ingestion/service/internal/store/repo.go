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

func (j *Jobs) Get(ctx context.Context, id uuid.UUID) (app.Job, error) {
	row, err := j.q.GetJob(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Job{}, app.ErrNotFound
	}
	if err != nil {
		return app.Job{}, err
	}
	return toJob(row), nil
}

func (j *Jobs) List(ctx context.Context, limit, offset int32) ([]app.Job, error) {
	rows, err := j.q.ListJobs(ctx, ListJobsParams{Limit: limit, Offset: offset})
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
		ID: t.ID, Status: int16(t.Status), Error: t.Error, ChunkCount: t.ChunkCount,
	})
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
		DocumentID:  row.DocumentID,
		Filename:    row.Filename,
		ContentType: row.ContentType,
		Status:      ingestionv1.JobStatus(row.Status),
		Error:       row.Error,
		ChunkCount:  row.ChunkCount,
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   row.UpdatedAt.Time,
	}
}
