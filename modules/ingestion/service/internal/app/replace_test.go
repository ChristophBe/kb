package app

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// GetByDocument and Restart mirror GetDocumentJob and RestartJob.

func (f *fakeJobs) GetByDocument(_ context.Context, owner string, documentID uuid.UUID) (Job, error) {
	for _, j := range f.jobs {
		if j.DocumentID == documentID && j.OwnerID == owner {
			return j, nil
		}
	}
	return Job{}, ErrNotFound
}

func (f *fakeJobs) Restart(_ context.Context, owner string, id uuid.UUID, filename, contentType string) (Job, error) {
	j, ok := f.jobs[id]
	if !ok || j.OwnerID != owner || j.Status == queued || j.Status == processing {
		return Job{}, ErrNotAdvanced
	}
	j.Status, j.Filename, j.ContentType, j.Error, j.ChunkCount, j.Run = pending, filename, contentType, "", 0, j.Run+1
	j.Progress = 0
	f.jobs[id] = j
	return j, nil
}

// Replace answers like Create: the new file's name and type, or createErr.
func (f *fakeDocuments) Replace(_ context.Context, id uuid.UUID, _ NewUpload) (Document, error) {
	if f.createErr != nil {
		return Document{}, f.createErr
	}
	doc := f.doc
	doc.ID = id
	return doc, nil
}

var newVersion = Document{Filename: "b.pdf", ContentType: "application/pdf", UploadURL: "http://s3/v2"}

func TestReplaceUploadRestartsTheDocumentsJob(t *testing.T) {
	for _, from := range []Job{doneJob(), failedJob(), pendingJob()} {
		jobs := newFakeJobs(from)
		publisher := &fakePublisher{}
		job, url, err := New(jobs, &fakeDocuments{doc: newVersion}, publisher).ReplaceUpload(t.Context(), alice, from.DocumentID, NewUpload{Filename: "b.pdf"})
		if err != nil {
			t.Fatalf("from %v: %v", from.Status, err)
		}
		if job.ID != from.ID || job.Status != pending || job.Run != from.Run+1 || job.Filename != "b.pdf" ||
			job.ContentType != "application/pdf" || job.Error != "" || url != "http://s3/v2" {
			t.Errorf("from %v: job %+v, url %q", from.Status, job, url)
		}
		if len(publisher.sent) != 0 {
			t.Errorf("published before the upload completed: %+v", publisher.sent)
		}
	}
}

func TestReplaceUploadThenCompleteQueuesTheNewRun(t *testing.T) {
	from := doneJob()
	jobs := newFakeJobs(from)
	publisher := &fakePublisher{}
	svc := New(jobs, &fakeDocuments{doc: newVersion}, publisher)
	job, _, err := svc.ReplaceUpload(t.Context(), alice, from.DocumentID, NewUpload{Filename: "b.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	job, err = svc.CompleteUpload(t.Context(), alice, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != queued || len(publisher.sent) != 1 || publisher.sent[0].Run != 2 || publisher.sent[0].Filename != "b.pdf" {
		t.Errorf("job %+v, published %+v", job, publisher.sent)
	}
}

func TestReplaceUploadOfADocumentWithoutAJobCreatesOne(t *testing.T) {
	jobs := newFakeJobs()
	documentID := uuid.New()
	job, _, err := New(jobs, &fakeDocuments{doc: newVersion}, &fakePublisher{}).ReplaceUpload(t.Context(), alice, documentID, NewUpload{Filename: "b.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if job.DocumentID != documentID || job.OwnerID != alice || job.Status != pending || len(jobs.jobs) != 1 {
		t.Errorf("job = %+v", job)
	}
}

func TestReplaceUploadRefusesAJobInProgress(t *testing.T) {
	for _, status := range []Job{queuedJob(), processingJob()} {
		documents := &fakeDocuments{doc: newVersion}
		jobs := newFakeJobs(status)
		_, _, err := New(jobs, documents, &fakePublisher{}).ReplaceUpload(t.Context(), alice, status.DocumentID, NewUpload{Filename: "b.pdf"})
		if !errors.Is(err, ErrDocumentBusy) {
			t.Errorf("%v: err = %v, want ErrDocumentBusy", status.Status, err)
		}
		if jobs.jobs[status.ID].Run != status.Run {
			t.Errorf("%v: the job was restarted", status.Status)
		}
	}
}

func TestReplaceUploadPassesOnTheDocumentModulesRefusal(t *testing.T) {
	for _, refusal := range []error{ErrDocumentBusy, ErrDocumentNotFound, ErrDocumentsUnavailable, &InvalidUploadError{}} {
		from := doneJob()
		jobs := newFakeJobs(from)
		_, _, err := New(jobs, &fakeDocuments{createErr: refusal}, &fakePublisher{}).ReplaceUpload(t.Context(), alice, from.DocumentID, NewUpload{})
		if !errors.Is(err, refusal) {
			t.Errorf("err = %v, want %v", err, refusal)
		}
		if jobs.jobs[from.ID] != from {
			t.Errorf("the job changed after %v: %+v", refusal, jobs.jobs[from.ID])
		}
	}
}

func TestReplaceUploadLeavesOtherUsersJobsAlone(t *testing.T) {
	theirs := doneJob()
	theirs.OwnerID = bob
	jobs := newFakeJobs(theirs)
	// The document module answers NotFound for bob's document.
	_, _, err := New(jobs, &fakeDocuments{createErr: ErrDocumentNotFound}, &fakePublisher{}).ReplaceUpload(t.Context(), alice, theirs.DocumentID, NewUpload{})
	if !errors.Is(err, ErrDocumentNotFound) || jobs.jobs[theirs.ID] != theirs {
		t.Errorf("err = %v, job %+v", err, jobs.jobs[theirs.ID])
	}
}

func doneJob() Job       { j := pendingJob(); j.Status, j.ChunkCount, j.Progress = done, 3, 100; return j }
func failedJob() Job     { j := pendingJob(); j.Status, j.Error = failed, "no text"; return j }
func queuedJob() Job     { j := pendingJob(); j.Status = queued; return j }
func processingJob() Job { j := pendingJob(); j.Status = processing; return j }
