package app

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestReindexDocumentReprocessesTheJobAsANewRun(t *testing.T) {
	for _, from := range []Job{doneJob(), failedJob()} {
		jobs := newFakeJobs(from)
		pub := &fakePublisher{}
		if err := New(jobs, &fakeDocuments{}, pub).ReindexDocument(t.Context(), alice, from.DocumentID); err != nil {
			t.Fatalf("from %v: %v", from.Status, err)
		}
		got := jobs.jobs[from.ID]
		if got.Status != queued || got.Run != from.Run+1 {
			t.Errorf("from %v: job %+v", from.Status, got)
		}
		if len(pub.sent) != 1 || pub.sent[0].ID != from.ID || pub.sent[0].Run != from.Run+1 {
			t.Errorf("from %v: published %+v", from.Status, pub.sent)
		}
		// Events of the run before are ignored, as for any reprocess.
		s := New(jobs, &fakeDocuments{}, pub)
		if err := s.ApplyFailed(t.Context(), from.ID, from.Run, "stale"); err != nil || jobs.jobs[from.ID].Status != queued {
			t.Errorf("stale event applied: %v %+v", err, jobs.jobs[from.ID])
		}
	}
}

func TestReindexDocumentWaitsForRunningJobs(t *testing.T) {
	for _, status := range []Job{{Status: queued}, {Status: processing}} {
		job := doneJob()
		job.Status = status.Status
		jobs := newFakeJobs(job)
		pub := &fakePublisher{}
		err := New(jobs, &fakeDocuments{}, pub).ReindexDocument(t.Context(), alice, job.DocumentID)
		if !errors.Is(err, ErrReindexBusy) || len(pub.sent) != 0 || jobs.jobs[job.ID].Run != job.Run {
			t.Errorf("status %v: err %v, published %+v, job %+v", job.Status, err, pub.sent, jobs.jobs[job.ID])
		}
	}
}

func TestReindexDocumentLeavesUnprocessedDocumentsAlone(t *testing.T) {
	waiting := pendingJob()
	jobs := newFakeJobs(waiting)
	pub := &fakePublisher{}
	s := New(jobs, &fakeDocuments{}, pub)
	if err := s.ReindexDocument(t.Context(), alice, waiting.DocumentID); err != nil {
		t.Errorf("waiting for its file: %v", err)
	}
	if err := s.ReindexDocument(t.Context(), alice, uuid.New()); err != nil {
		t.Errorf("no job: %v", err)
	}
	if len(pub.sent) != 0 || jobs.jobs[waiting.ID].Run != waiting.Run {
		t.Errorf("published %+v, job %+v", pub.sent, jobs.jobs[waiting.ID])
	}
}

func TestReindexDocumentActsForTheOwnerOnly(t *testing.T) {
	job := doneJob()
	jobs := newFakeJobs(job)
	pub := &fakePublisher{}
	if err := New(jobs, &fakeDocuments{}, pub).ReindexDocument(t.Context(), bob, job.DocumentID); err != nil {
		t.Fatal(err)
	}
	if len(pub.sent) != 0 || jobs.jobs[job.ID].Status != done {
		t.Errorf("bob reindexed alice's document: %+v", jobs.jobs[job.ID])
	}
}
