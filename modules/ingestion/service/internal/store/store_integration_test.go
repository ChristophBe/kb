//go:build integration

package store

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/migrations"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/platform/go/postgres"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

const (
	pendingUpload = 1
	queued        = 2
	processing    = 3
	done          = 4
	failed        = 5

	// owner owns the jobs of tests that aren't about ownership.
	owner = "alice"
	// alice is the subject of the Dex dev user alice, who gets the jobs from
	// before ownership.
	aliceSubject = "CgVhbGljZRIFbG9jYWw"
)

func newJob(t *testing.T, q *Queries, status int16) uuid.UUID {
	t.Helper()
	return newOwnedJob(t, q, owner, status)
}

func newOwnedJob(t *testing.T, q *Queries, ownerID string, status int16) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := q.CreateJob(t.Context(), CreateJobParams{
		ID: id, OwnerID: ownerID, DocumentID: uuid.New(), Filename: "a.md", ContentType: "text/markdown", Status: status,
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAdvanceJob(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))

	t.Run("moves forward and records the result", func(t *testing.T) {
		id := newJob(t, q, pendingUpload)
		for _, status := range []int16{queued, processing} {
			job, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: status})
			if err != nil || job.Status != status {
				t.Fatalf("to %d: status %d, err %v", status, job.Status, err)
			}
		}
		job, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: done, ChunkCount: 7})
		if err != nil || job.Status != done || job.ChunkCount != 7 {
			t.Fatalf("to done: %+v, err %v", job, err)
		}
	})

	t.Run("records the error of a failed job", func(t *testing.T) {
		id := newJob(t, q, processing)
		job, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: failed, Error: "no text"})
		if err != nil || job.Status != failed || job.Error != "no text" {
			t.Fatalf("job %+v, err %v", job, err)
		}
	})

	t.Run("skips states", func(t *testing.T) {
		// Events can arrive out of order: processed may overtake started.
		id := newJob(t, q, queued)
		if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: done}); err != nil {
			t.Fatal(err)
		}
	})

	for _, tc := range []struct {
		name     string
		from, to int16
	}{
		{"never moves backwards", processing, queued},
		{"ignores a duplicate", processing, processing},
		{"never leaves done for a later status", done, failed},
		{"never leaves done for an earlier status", done, processing},
		{"never leaves failed for an earlier status", failed, done},
		{"ignores a duplicate terminal status", failed, failed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := newJob(t, q, tc.from)
			_, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: tc.to, Error: "late"})
			if !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
			job, err := q.GetJob(t.Context(), GetJobParams{ID: id, OwnerID: owner})
			if err != nil {
				t.Fatal(err)
			}
			if job.Status != tc.from || job.Error != "" {
				t.Errorf("job changed: status %d, error %q", job.Status, job.Error)
			}
		})
	}

	t.Run("does not advance an unknown job", func(t *testing.T) {
		_, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: uuid.New(), Run: 1, Status: done})
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err = %v, want ErrNoRows", err)
		}
	})
}

func TestReportProgress(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	const (
		chunking  = 2
		embedding = 3
		storing   = 4
	)
	report := func(id uuid.UUID, run int32, stage, progress int16) (IngestionJob, error) {
		return q.ReportProgress(t.Context(), ReportProgressParams{ID: id, Run: run, Stage: stage, Progress: progress})
	}

	t.Run("records progress and marks a queued job processing", func(t *testing.T) {
		id := newJob(t, q, queued)
		before, err := q.GetJob(t.Context(), GetJobParams{ID: id, OwnerID: owner})
		if err != nil {
			t.Fatal(err)
		}
		job, err := report(id, 1, embedding, 40)
		if err != nil || job.Status != processing || job.Stage != embedding || job.Progress != 40 {
			t.Fatalf("job %+v, err %v", job, err)
		}
		if !job.UpdatedAt.Time.After(before.UpdatedAt.Time) {
			t.Errorf("updated_at not bumped: %v -> %v", before.UpdatedAt.Time, job.UpdatedAt.Time)
		}
		if job, err = report(id, 1, storing, 40); err != nil || job.Stage != storing {
			t.Fatalf("next stage: %+v, err %v", job, err)
		}
	})

	for _, tc := range []struct {
		name            string
		run             int32
		stage, progress int16
	}{
		{"ignores a duplicate", 1, embedding, 40},
		{"ignores lower progress", 1, embedding, 20},
		{"ignores an earlier stage", 1, chunking, 90},
		{"ignores another run", 2, storing, 90},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := newJob(t, q, processing)
			if _, err := report(id, 1, embedding, 40); err != nil {
				t.Fatal(err)
			}
			if _, err := report(id, tc.run, tc.stage, tc.progress); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
			job, err := q.GetJob(t.Context(), GetJobParams{ID: id, OwnerID: owner})
			if err != nil || job.Stage != embedding || job.Progress != 40 {
				t.Errorf("job changed: %+v, err %v", job, err)
			}
		})
	}

	for _, from := range []int16{pendingUpload, done, failed} {
		t.Run(fmt.Sprintf("leaves status %d alone", from), func(t *testing.T) {
			id := newJob(t, q, from)
			if _, err := report(id, 1, embedding, 40); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
		})
	}

	t.Run("done means 100 percent and reprocessing starts over", func(t *testing.T) {
		id := newJob(t, q, processing)
		if _, err := report(id, 1, embedding, 60); err != nil {
			t.Fatal(err)
		}
		job, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: done, ChunkCount: 3})
		if err != nil || job.Progress != 100 {
			t.Fatalf("done: %+v, err %v", job, err)
		}
		job, err = q.ReprocessJob(t.Context(), ReprocessJobParams{ID: id, OwnerID: owner})
		if err != nil || job.Progress != 0 || job.Stage != 0 {
			t.Fatalf("reprocessed: %+v, err %v", job, err)
		}
		if job, err = report(id, 2, chunking, 5); err != nil || job.Progress != 5 {
			t.Fatalf("run 2: %+v, err %v", job, err)
		}
	})

	t.Run("a failed job keeps its progress", func(t *testing.T) {
		id := newJob(t, q, processing)
		if _, err := report(id, 1, embedding, 60); err != nil {
			t.Fatal(err)
		}
		job, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: failed, Error: "boom"})
		if err != nil || job.Progress != 60 {
			t.Fatalf("failed: %+v, err %v", job, err)
		}
	})
}

func TestReprocessJob(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))

	for _, from := range []int16{done, failed} {
		t.Run(fmt.Sprintf("queues status %d as the next run", from), func(t *testing.T) {
			id := newJob(t, q, processing)
			if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: from, Error: "no text", ChunkCount: 7}); err != nil {
				t.Fatal(err)
			}
			job, err := q.ReprocessJob(t.Context(), ReprocessJobParams{ID: id, OwnerID: owner})
			if err != nil {
				t.Fatal(err)
			}
			if job.Status != queued || job.Run != 2 || job.Error != "" || job.ChunkCount != 0 {
				t.Fatalf("job = %+v", job)
			}
			// A late event of run 1 no longer applies; run 2 moves on.
			if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: failed, Error: "late"}); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("run 1 event: err = %v, want ErrNoRows", err)
			}
			job, err = q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 2, Status: done, ChunkCount: 3})
			if err != nil || job.Status != done || job.ChunkCount != 3 {
				t.Fatalf("run 2 event: %+v, err %v", job, err)
			}
		})
	}

	for _, from := range []int16{pendingUpload, queued, processing} {
		t.Run(fmt.Sprintf("leaves status %d alone", from), func(t *testing.T) {
			id := newJob(t, q, from)
			if _, err := q.ReprocessJob(t.Context(), ReprocessJobParams{ID: id, OwnerID: owner}); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
			job, err := q.GetJob(t.Context(), GetJobParams{ID: id, OwnerID: owner})
			if err != nil || job.Status != from || job.Run != 1 {
				t.Fatalf("job changed: %+v, err %v", job, err)
			}
		})
	}

	t.Run("does not reprocess an unknown job", func(t *testing.T) {
		if _, err := q.ReprocessJob(t.Context(), ReprocessJobParams{ID: uuid.New(), OwnerID: owner}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err = %v, want ErrNoRows", err)
		}
	})
}

func TestListJobsPagesNewestFirst(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	first, second := newJob(t, q, queued), newJob(t, q, queued)
	jobs, err := q.ListJobs(t.Context(), ListJobsParams{OwnerID: owner, Limit: 1, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != second {
		t.Errorf("first page = %+v, want job %v", jobs, second)
	}
	jobs, err = q.ListJobs(t.Context(), ListJobsParams{OwnerID: owner, Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != first {
		t.Errorf("second page = %+v, want job %v", jobs, first)
	}
}

func TestJobQueriesFindOnlyTheOwnersJobs(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	ctx := t.Context()
	mine, theirs := newOwnedJob(t, q, "alice", failed), newOwnedJob(t, q, "bob", failed)

	jobs, err := q.ListJobs(ctx, ListJobsParams{OwnerID: "alice", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != mine || jobs[0].OwnerID != "alice" {
		t.Errorf("alice lists %+v, want only her job", jobs)
	}
	if _, err := q.GetJob(ctx, GetJobParams{ID: theirs, OwnerID: "alice"}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("get bob's job as alice: err = %v, want no rows", err)
	}
	if _, err := q.ReprocessJob(ctx, ReprocessJobParams{ID: theirs, OwnerID: "alice"}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("reprocess bob's job as alice: err = %v, want no rows", err)
	}
	got, err := q.GetJob(ctx, GetJobParams{ID: theirs, OwnerID: "bob"})
	if err != nil || got.Status != failed || got.Run != 1 {
		t.Errorf("bob's job after alice's attempts: %+v, %v", got, err)
	}
	if _, err := q.ReprocessJob(ctx, ReprocessJobParams{ID: theirs, OwnerID: "bob"}); err != nil {
		t.Errorf("reprocess as the owner: %v", err)
	}
	// The worker's events carry no user and still apply to any job.
	if _, err := q.AdvanceJob(ctx, AdvanceJobParams{ID: theirs, Run: 2, Status: processing}); err != nil {
		t.Errorf("advance without an owner: %v", err)
	}
}

func TestOwnerMigrationGivesExistingJobsToAlice(t *testing.T) {
	// Migrate up to the version before owners, add a job, then migrate on.
	before := fstest.MapFS{}
	err := fs.WalkDir(migrations.FS, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || name >= "00004" {
			return err
		}
		data, err := fs.ReadFile(migrations.FS, name)
		before[name] = &fstest.MapFile{Data: data}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	pool := pgtest.Start(t, "ingestion", before)
	ctx := t.Context()
	id := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO ingestion.jobs (id, document_id, filename, content_type, status)
		VALUES ($1, $2, 'old.md', 'text/markdown', 4)`, id, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Migrate(ctx, pool, "ingestion", migrations.FS, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}

	q := New(pool)
	job, err := q.GetJob(ctx, GetJobParams{ID: id, OwnerID: aliceSubject})
	if err != nil || job.OwnerID != aliceSubject || job.Filename != "old.md" {
		t.Fatalf("old job as alice: %+v, %v", job, err)
	}
	// New jobs need an owner: the backfill default is gone.
	_, err = pool.Exec(ctx, `INSERT INTO ingestion.jobs (id, document_id, filename, content_type, status)
		VALUES ($1, $2, 'new.md', 'text/markdown', 1)`, uuid.New(), uuid.New())
	if err == nil || !strings.Contains(err.Error(), "owner_id") {
		t.Errorf("job without an owner: err = %v, want a not-null violation", err)
	}
}

func TestJobMetrics(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	ctx := t.Context()
	jobs := NewJobs(q)
	transitions := func(status string) float64 {
		return testutil.ToFloat64(jobTransitions.WithLabelValues(status))
	}
	queuedBefore, doneBefore := transitions("queued"), transitions("done")

	job, err := jobs.Create(ctx, app.Job{ID: uuid.New(), OwnerID: owner, DocumentID: uuid.New(), Filename: "a.md", Status: pendingUpload})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []ingestionv1.JobStatus{queued, done, done} { // the second DONE is a redelivery
		_, _ = jobs.Advance(ctx, app.Transition{ID: job.ID, Run: 1, Status: status})
	}
	newJob(t, q, queued)
	if got := transitions("queued") - queuedBefore; got != 1 {
		t.Errorf("queued transitions = %v, want 1", got)
	}
	if got := transitions("done") - doneBefore; got != 1 {
		t.Errorf("done transitions = %v, want 1 (a redelivered event must not count)", got)
	}

	reg := prometheus.NewPedanticRegistry()
	reg.MustRegister(NewJobsCollector(q))
	want := `
# HELP kb_ingestion_jobs Jobs per status in the database, counted at scrape time (queue depth: status="queued").
# TYPE kb_ingestion_jobs gauge
kb_ingestion_jobs{status="done"} 1
kb_ingestion_jobs{status="failed"} 0
kb_ingestion_jobs{status="pending_upload"} 0
kb_ingestion_jobs{status="processing"} 0
kb_ingestion_jobs{status="queued"} 1
`
	if err := testutil.GatherAndCompare(reg, strings.NewReader(want), "kb_ingestion_jobs"); err != nil {
		t.Error(err)
	}
}
