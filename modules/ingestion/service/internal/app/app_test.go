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

// fakeJobs mirrors the AdvanceJob and ReprocessJob queries: forward only
// within the current run, nothing after a terminal status until reprocessed.
type fakeJobs struct {
	jobs         map[uuid.UUID]Job
	createErr    error
	advanceErr   error
	reprocessErr error
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
	if !ok || j.Run != t.Run || j.Terminal() || j.Status >= t.Status {
		return Job{}, ErrNotAdvanced
	}
	j.Status, j.Error, j.ChunkCount = t.Status, t.Error, t.ChunkCount
	if t.Status == done {
		j.Progress = 100
	}
	f.jobs[t.ID] = j
	return j, nil
}

func (f *fakeJobs) ReportProgress(_ context.Context, p Progress) (Job, error) {
	if f.advanceErr != nil {
		return Job{}, f.advanceErr
	}
	j, ok := f.jobs[p.ID]
	if !ok || j.Run != p.Run || (j.Status != queued && j.Status != processing) ||
		j.Stage > p.Stage || (j.Stage == p.Stage && j.Progress >= p.Progress) {
		return Job{}, ErrNotAdvanced
	}
	j.Status, j.Stage, j.Progress = processing, p.Stage, p.Progress
	f.jobs[p.ID] = j
	return j, nil
}

func (f *fakeJobs) Reprocess(_ context.Context, id uuid.UUID) (Job, error) {
	if f.reprocessErr != nil {
		return Job{}, f.reprocessErr
	}
	j, ok := f.jobs[id]
	if !ok || !j.Terminal() {
		return Job{}, ErrNotAdvanced
	}
	j.Status, j.Error, j.ChunkCount, j.Run = queued, "", 0, j.Run+1
	j.Stage, j.Progress = ingestionv1.JobStage_JOB_STAGE_UNSPECIFIED, 0
	f.jobs[id] = j
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
	return Job{ID: uuid.New(), DocumentID: uuid.New(), Status: pending, Run: 1}
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

	if err := s.ApplyStarted(t.Context(), job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID].Status; got != processing {
		t.Fatalf("after started: %v", got)
	}
	if err := s.ApplyProcessed(t.Context(), job.ID, 1, 7); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.ChunkCount != 7 {
		t.Fatalf("after processed: %+v", got)
	}
}

func TestProgressEventsRecordStageAndProgress(t *testing.T) {
	embedding := ingestionv1.JobStage_JOB_STAGE_EMBEDDING
	job := pendingJob()
	job.Status = queued
	jobs := newFakeJobs(job)
	s := New(jobs, &fakeDocuments{}, &fakePublisher{})

	// The started event may arrive late: progress already means PROCESSING.
	if err := s.ApplyProgress(t.Context(), job.ID, 1, embedding, 40); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != processing || got.Stage != embedding || got.Progress != 40 {
		t.Fatalf("after progress: %+v", got)
	}
	// Stale reports, other runs and out-of-range values don't move it back.
	for _, p := range []struct {
		run      int32
		stage    ingestionv1.JobStage
		progress int32
	}{
		{1, embedding, 20},
		{1, ingestionv1.JobStage_JOB_STAGE_CHUNKING, 90},
		{2, ingestionv1.JobStage_JOB_STAGE_STORING, 90},
		{1, embedding, -5},
	} {
		if err := s.ApplyProgress(t.Context(), job.ID, p.run, p.stage, p.progress); err != nil {
			t.Fatal(err)
		}
	}
	if got := jobs.jobs[job.ID]; got.Stage != embedding || got.Progress != 40 {
		t.Fatalf("stale progress applied: %+v", got)
	}
	if err := s.ApplyProgress(t.Context(), job.ID, 1, embedding, 250); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID].Progress; got != 100 {
		t.Errorf("progress = %d, want it clamped to 100", got)
	}
	if err := s.ApplyProcessed(t.Context(), job.ID, 1, 3); err != nil {
		t.Fatal(err)
	}
	// A late progress report doesn't touch a finished job.
	if err := s.ApplyProgress(t.Context(), job.ID, 1, ingestionv1.JobStage_JOB_STAGE_STORING, 90); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.Progress != 100 {
		t.Errorf("after processed: %+v", got)
	}
}

func TestApplyProgressReportsStoreFailures(t *testing.T) {
	jobs := newFakeJobs()
	jobs.advanceErr = errors.New("database down")
	err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyProgress(t.Context(), uuid.New(), 1, ingestionv1.JobStage_JOB_STAGE_EMBEDDING, 10)
	if !errors.Is(err, jobs.advanceErr) {
		t.Fatalf("err = %v, want retry", err)
	}
}

func TestFailedEventRecordsTheReason(t *testing.T) {
	job := pendingJob()
	job.Status = processing
	jobs := newFakeJobs(job)
	if err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyFailed(t.Context(), job.ID, 1, "no text"); err != nil {
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

	if err := s.ApplyStarted(t.Context(), job.ID, 1); err != nil {
		t.Fatalf("stale event: %v", err)
	}
	if err := s.ApplyFailed(t.Context(), job.ID, 1, "late"); err != nil {
		t.Fatalf("stale event: %v", err)
	}
	if err := s.ApplyStarted(t.Context(), uuid.New(), 1); err != nil {
		t.Fatalf("unknown job: %v", err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.Error != "" {
		t.Errorf("job changed: %+v", got)
	}
}

func TestApplyReportsStoreFailures(t *testing.T) {
	jobs := newFakeJobs()
	jobs.advanceErr = errors.New("database down")
	if err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyStarted(t.Context(), uuid.New(), 1); !errors.Is(err, jobs.advanceErr) {
		t.Fatalf("err = %v, want retry", err)
	}
}

func TestEventsWithoutARunBelongToTheFirstRun(t *testing.T) {
	job := pendingJob()
	job.Status = queued
	jobs := newFakeJobs(job)
	if err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ApplyStarted(t.Context(), job.ID, 0); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID].Status; got != processing {
		t.Errorf("status = %v, want PROCESSING", got)
	}
}

func TestReprocessQueuesATerminalJobAsANewRun(t *testing.T) {
	for _, from := range []ingestionv1.JobStatus{failed, done} {
		t.Run(from.String(), func(t *testing.T) {
			job := pendingJob()
			job.Status, job.Error, job.ChunkCount = from, "no text", 7
			jobs, pub := newFakeJobs(job), &fakePublisher{}
			got, err := New(jobs, &fakeDocuments{}, pub).ReprocessJob(t.Context(), job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != queued || got.Run != 2 || got.Error != "" || got.ChunkCount != 0 {
				t.Errorf("job = %+v", got)
			}
			if len(pub.sent) != 1 || pub.sent[0].ID != job.ID || pub.sent[0].Run != 2 {
				t.Errorf("published = %+v", pub.sent)
			}
		})
	}
}

func TestReprocessedJobIgnoresEventsOfTheEarlierRun(t *testing.T) {
	job := pendingJob()
	job.Status = failed
	jobs := newFakeJobs(job)
	s := New(jobs, &fakeDocuments{}, &fakePublisher{})
	if _, err := s.ReprocessJob(t.Context(), job.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyFailed(t.Context(), job.ID, 1, "late"); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != queued {
		t.Fatalf("late event of run 1 applied: %+v", got)
	}
	if err := s.ApplyProcessed(t.Context(), job.ID, 2, 3); err != nil {
		t.Fatal(err)
	}
	if got := jobs.jobs[job.ID]; got.Status != done || got.ChunkCount != 3 {
		t.Errorf("run 2 not applied: %+v", got)
	}
}

func TestReprocessRejectsJobsThatAreNotTerminal(t *testing.T) {
	for _, from := range []ingestionv1.JobStatus{pending, queued, processing} {
		t.Run(from.String(), func(t *testing.T) {
			job := pendingJob()
			job.Status = from
			jobs, pub := newFakeJobs(job), &fakePublisher{}
			_, err := New(jobs, &fakeDocuments{}, pub).ReprocessJob(t.Context(), job.ID)
			if !errors.Is(err, ErrNotReprocessable) {
				t.Fatalf("err = %v, want ErrNotReprocessable", err)
			}
			if jobs.jobs[job.ID].Status != from || len(pub.sent) != 0 {
				t.Errorf("job changed: %+v, published %v", jobs.jobs[job.ID], pub.sent)
			}
		})
	}
}

func TestReprocessUnknownJob(t *testing.T) {
	_, err := New(newFakeJobs(), &fakeDocuments{}, &fakePublisher{}).ReprocessJob(t.Context(), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestReprocessStoreFailure(t *testing.T) {
	jobs := newFakeJobs()
	jobs.reprocessErr = errors.New("database down")
	_, err := New(jobs, &fakeDocuments{}, &fakePublisher{}).ReprocessJob(t.Context(), uuid.New())
	if !errors.Is(err, jobs.reprocessErr) {
		t.Fatalf("err = %v", err)
	}
}

func TestReprocessPublishFailureFailsTheJobAgain(t *testing.T) {
	job := pendingJob()
	job.Status = failed
	jobs := newFakeJobs(job)
	broken := errors.New("nats down")
	_, err := New(jobs, &fakeDocuments{}, &fakePublisher{err: broken}).ReprocessJob(t.Context(), job.ID)
	if !errors.Is(err, broken) {
		t.Fatalf("err = %v", err)
	}
	if got := jobs.jobs[job.ID]; got.Status != failed || got.Run != 2 || got.Error == "" {
		t.Errorf("job = %+v, want FAILED in run 2 so it can be retried", got)
	}
}
