//go:build integration

package store

import (
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/christoph/kb/modules/ingestion/migrations"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

const (
	pendingUpload = 1
	queued        = 2
	processing    = 3
	done          = 4
	failed        = 5
)

func newJob(t *testing.T, q *Queries, status int16) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := q.CreateJob(t.Context(), CreateJobParams{
		ID: id, DocumentID: uuid.New(), Filename: "a.md", ContentType: "text/markdown", Status: status,
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
			job, err := q.GetJob(t.Context(), id)
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

func TestReprocessJob(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))

	for _, from := range []int16{done, failed} {
		t.Run(fmt.Sprintf("queues status %d as the next run", from), func(t *testing.T) {
			id := newJob(t, q, processing)
			if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: from, Error: "no text", ChunkCount: 7}); err != nil {
				t.Fatal(err)
			}
			job, err := q.ReprocessJob(t.Context(), id)
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
			if _, err := q.ReprocessJob(t.Context(), id); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
			job, err := q.GetJob(t.Context(), id)
			if err != nil || job.Status != from || job.Run != 1 {
				t.Fatalf("job changed: %+v, err %v", job, err)
			}
		})
	}

	t.Run("does not reprocess an unknown job", func(t *testing.T) {
		if _, err := q.ReprocessJob(t.Context(), uuid.New()); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err = %v, want ErrNoRows", err)
		}
	})
}

func TestListJobsPagesNewestFirst(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	first, second := newJob(t, q, queued), newJob(t, q, queued)
	jobs, err := q.ListJobs(t.Context(), ListJobsParams{Limit: 1, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != second {
		t.Errorf("first page = %+v, want job %v", jobs, second)
	}
	jobs, err = q.ListJobs(t.Context(), ListJobsParams{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != first {
		t.Errorf("second page = %+v, want job %v", jobs, first)
	}
}
