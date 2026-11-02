package app

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
)

const (
	pending    = ingestionv1.JobStatus_JOB_STATUS_PENDING_UPLOAD
	queued     = ingestionv1.JobStatus_JOB_STATUS_QUEUED
	processing = ingestionv1.JobStatus_JOB_STATUS_PROCESSING
	done       = ingestionv1.JobStatus_JOB_STATUS_DONE
	failed     = ingestionv1.JobStatus_JOB_STATUS_FAILED
)

// fakeJobs mirrors the AdvanceJob query: forward only, nothing after a terminal status.
type fakeJobs struct {
	jobs       map[uuid.UUID]Job
	createErr  error
	advanceErr error
}

func newFakeJobs(jobs ...Job) *fakeJobs {
	f := &fakeJobs{jobs: map[uuid.UUID]Job{}}
	for _, j := range jobs {
		f.jobs[j.ID] = j
	}
	return f
}

func (f *fakeJobs) Create(_ context.Context, job Job) (Job, error) {
	if f.createErr != nil {
		return Job{}, f.createErr
	}
	f.jobs[job.ID] = job
	return job, nil
}

func (f *fakeJobs) Get(_ context.Context, id uuid.UUID) (Job, error) {
	j, ok := f.jobs[id]
	if !ok {
		return Job{}, ErrNotFound
	}
	return j, nil
}

func (f *fakeJobs) List(context.Context, int32, int32) ([]Job, error) { return nil, nil }

func (f *fakeJobs) Advance(_ context.Context, t Transition) (Job, error) {
	if f.advanceErr != nil {
		return Job{}, f.advanceErr
	}
	j, ok := f.jobs[t.ID]
	if !ok || j.Terminal() || j.Status >= t.Status {
		return Job{}, ErrNotAdvanced
	}
	j.Status, j.Error, j.ChunkCount = t.Status, t.Error, t.ChunkCount
	f.jobs[t.ID] = j
	return j, nil
}

type fakeDocuments struct {
	doc       Document
	createErr error
	markErr   error
	marked    []uuid.UUID
}

func (f *fakeDocuments) Create(context.Context, NewUpload) (Document, error) {
	return f.doc, f.createErr
}

func (f *fakeDocuments) MarkUploaded(_ context.Context, id uuid.UUID) error {
	f.marked = append(f.marked, id)
	return f.markErr
}

type fakePublisher struct {
	sent []Job
	err  error
}

func (f *fakePublisher) PublishUploaded(_ context.Context, job Job) error {
	f.sent = append(f.sent, job)
	return f.err
}

func pendingJob() Job {
	return Job{ID: uuid.New(), DocumentID: uuid.New(), Status: pending}
}

func TestCreateUploadStoresAPendingJob(t *testing.T) {
	doc := Document{ID: uuid.New(), Filename: "a.md", ContentType: "text/markdown", UploadURL: "http://s3/up"}
	jobs := newFakeJobs()
	job, url, err := New(jobs, &fakeDocuments{doc: doc}, &fakePublisher{}).CreateUpload(t.Context(), NewUpload{Filename: "a.md"})
	if err != nil {
		t.Fatal(err)
	}
	if url != doc.UploadURL || job.DocumentID != doc.ID || job.Status != pending || job.ContentType != doc.ContentType {
		t.Errorf("url %q, job %+v", url, job)
	}
	if _, ok := jobs.jobs[job.ID]; !ok {
		t.Error("job not stored")
	}
}

func TestCreateUploadFailures(t *testing.T) {
	storeDown := errors.New("database down")
	for _, tc := range []struct {
		name      string
		createDoc error
		createJob error
		want      error
	}{
		{"documents unavailable", ErrDocumentsUnavailable, nil, ErrDocumentsUnavailable},
		{"job not stored", nil, storeDown, storeDown},
	} {
		t.Run(tc.name, func(t *testing.T) {
			jobs := newFakeJobs()
			jobs.createErr = tc.createJob
			_, _, err := New(jobs, &fakeDocuments{createErr: tc.createDoc}, &fakePublisher{}).CreateUpload(t.Context(), NewUpload{})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestCompleteUploadQueuesAndPublishes(t *testing.T) {
	job := pendingJob()
	docs, pub := &fakeDocuments{}, &fakePublisher{}
	got, err := New(newFakeJobs(job), docs, pub).CompleteUpload(t.Context(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != queued {
		t.Errorf("status = %v", got.Status)
	}
	if len(docs.marked) != 1 || docs.marked[0] != job.DocumentID {
		t.Errorf("marked = %v", docs.marked)
	}
	if len(pub.sent) != 1 || pub.sent[0].ID != job.ID {
		t.Errorf("published = %v", pub.sent)
	}
}

func TestCompleteUploadThatCannotProceedLeavesTheJobPending(t *testing.T) {
	for _, want := range []error{ErrUploadMissing, ErrDocumentsUnavailable} {
		t.Run(want.Error(), func(t *testing.T) {
			job := pendingJob()
			jobs, pub := newFakeJobs(job), &fakePublisher{}
			_, err := New(jobs, &fakeDocuments{markErr: want}, pub).CompleteUpload(t.Context(), job.ID)
			if !errors.Is(err, want) {
				t.Fatalf("err = %v, want %v", err, want)
			}
			if jobs.jobs[job.ID].Status != pending {
				t.Errorf("status = %v, want PENDING_UPLOAD", jobs.jobs[job.ID].Status)
			}
			if len(pub.sent) != 0 {
				t.Errorf("published = %v", pub.sent)
			}
		})
	}
}

func TestCompleteUploadUnknownJob(t *testing.T) {
	_, err := New(newFakeJobs(), &fakeDocuments{}, &fakePublisher{}).CompleteUpload(t.Context(), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestCompleteUploadTwice(t *testing.T) {
	job := pendingJob()
	docs := &fakeDocuments{}
	s := New(newFakeJobs(job), docs, &fakePublisher{})
	if _, err := s.CompleteUpload(t.Context(), job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteUpload(t.Context(), job.ID); !errors.Is(err, ErrAlreadyCompleted) {
		t.Fatalf("err = %v", err)
	}
	if len(docs.marked) != 1 {
		t.Errorf("document marked %d times", len(docs.marked))
	}
}

func TestCompleteUploadLosingARace(t *testing.T) {
	job := pendingJob()
	jobs := newFakeJobs(job)
	jobs.advanceErr = ErrNotAdvanced
	pub := &fakePublisher{}
	_, err := New(jobs, &fakeDocuments{}, pub).CompleteUpload(t.Context(), job.ID)
	if !errors.Is(err, ErrAlreadyCompleted) {
		t.Fatalf("err = %v", err)
	}
	if len(pub.sent) != 0 {
		t.Errorf("published = %v", pub.sent)
	}
}

func TestCompleteUploadPublishFailure(t *testing.T) {
	job := pendingJob()
	broken := errors.New("nats down")
	_, err := New(newFakeJobs(job), &fakeDocuments{}, &fakePublisher{err: broken}).CompleteUpload(t.Context(), job.ID)
	if !errors.Is(err, broken) {
		t.Fatalf("err = %v", err)
	}
}

func TestProcessingEventsMoveTheJobForward(t *testing.T) {
	job := pendingJob()
	job.Status = queued
	jobs := newFakeJobs(job)
	s := New(jobs, &fakeDocuments{}, &fakePublisher{})

	if err := s.ApplyStarted(t.Context(), job.ID); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID].Status; got != processing {
		t.Fatalf("after started: %v", got)
	}
	if err := s.ApplyProcessed(t.Context(), job.ID, 7); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.ChunkCount != 7 {
		t.Fatalf("after processed: %+v", got)
	}
}

func TestFailedEventRecordsTheReason(t *testing.T) {
	job := pendingJob()
	job.Status = processing
	jobs := newFakeJobs(job)
	if err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyFailed(t.Context(), job.ID, "no text"); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != failed || got.Error != "no text" {
		t.Fatalf("job = %+v", got)
	}
}

func TestStaleEventsAreIgnored(t *testing.T) {
	job := pendingJob()
	job.Status = done
	jobs := newFakeJobs(job)
	s := New(jobs, &fakeDocuments{}, &fakePublisher{})

	if err := s.ApplyStarted(t.Context(), job.ID); err != nil {
		t.Fatalf("stale event: %v", err)
	}
	if err := s.ApplyFailed(t.Context(), job.ID, "late"); err != nil {
		t.Fatalf("stale event: %v", err)
	}
	if err := s.ApplyStarted(t.Context(), uuid.New()); err != nil {
		t.Fatalf("unknown job: %v", err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.Error != "" {
		t.Errorf("job changed: %+v", got)
	}
}

func TestApplyReportsStoreFailures(t *testing.T) {
	jobs := newFakeJobs()
	jobs.advanceErr = errors.New("database down")
	if err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyStarted(t.Context(), uuid.New()); !errors.Is(err, jobs.advanceErr) {
		t.Fatalf("err = %v, want retry", err)
	}
}
