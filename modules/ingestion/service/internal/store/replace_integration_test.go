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

func TestGetDocumentJob(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))
	id := newJob(t, q, done)
	job, err := q.GetJob(t.Context(), GetJobParams{ID: id, OwnerID: owner})
	if err != nil {
		t.Fatal(err)
	}
	got, err := q.GetDocumentJob(t.Context(), GetDocumentJobParams{DocumentID: job.DocumentID, OwnerID: owner})
	if err != nil || got.ID != id {
		t.Fatalf("job = %+v, err %v", got, err)
	}
	if _, err := q.GetDocumentJob(t.Context(), GetDocumentJobParams{DocumentID: job.DocumentID, OwnerID: "bob"}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("another owner: err = %v, want ErrNoRows", err)
	}
	if _, err := q.GetDocumentJob(t.Context(), GetDocumentJobParams{DocumentID: uuid.New(), OwnerID: owner}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("unknown document: err = %v, want ErrNoRows", err)
	}
}

func TestRestartJob(t *testing.T) {
	q := New(pgtest.Start(t, "ingestion", migrations.FS))

	for _, from := range []int16{pendingUpload, done, failed} {
		t.Run(fmt.Sprintf("restarts status %d as the next run", from), func(t *testing.T) {
			id := newJob(t, q, pendingUpload)
			if from != pendingUpload {
				if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: from, Error: "no text", ChunkCount: 7}); err != nil {
					t.Fatal(err)
				}
			}
			job, err := q.RestartJob(t.Context(), RestartJobParams{ID: id, OwnerID: owner, Filename: "b.pdf", ContentType: "application/pdf"})
			if err != nil {
				t.Fatal(err)
			}
			if job.Status != pendingUpload || job.Run != 2 || job.Error != "" || job.ChunkCount != 0 || job.Progress != 0 ||
				job.Filename != "b.pdf" || job.ContentType != "application/pdf" {
				t.Fatalf("job = %+v", job)
			}
			// Run 2 then goes through the usual states; run 1's events don't apply.
			if _, err := q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 1, Status: done}); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("run 1 event: err = %v, want ErrNoRows", err)
			}
			if job, err = q.AdvanceJob(t.Context(), AdvanceJobParams{ID: id, Run: 2, Status: queued}); err != nil || job.Status != queued {
				t.Fatalf("queue run 2: %+v, %v", job, err)
			}
		})
	}

	for _, from := range []int16{queued, processing} {
		t.Run(fmt.Sprintf("leaves status %d alone", from), func(t *testing.T) {
			id := newJob(t, q, from)
			if _, err := q.RestartJob(t.Context(), RestartJobParams{ID: id, OwnerID: owner, Filename: "b.pdf"}); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("err = %v, want ErrNoRows", err)
			}
		})
	}

	t.Run("leaves another owner's job alone", func(t *testing.T) {
		id := newJob(t, q, failed)
		if _, err := q.RestartJob(t.Context(), RestartJobParams{ID: id, OwnerID: "bob", Filename: "b.pdf"}); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err = %v, want ErrNoRows", err)
		}
	})
}
