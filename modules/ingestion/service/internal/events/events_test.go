package events

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
)

type fakeJobs struct {
	calls    []string
	id       uuid.UUID
	runs     []int32
	count    int32
	why      string
	stage    ingestionv1.JobStage
	progress int32
	err      error
}

func (f *fakeJobs) ApplyProgress(_ context.Context, id uuid.UUID, run int32, stage ingestionv1.JobStage, progress int32) error {
	f.calls, f.id, f.runs = append(f.calls, "progress"), id, append(f.runs, run)
	f.stage, f.progress = stage, progress
	return f.err
}

func (f *fakeJobs) ApplyStarted(_ context.Context, id uuid.UUID, run int32) error {
	f.calls, f.id, f.runs = append(f.calls, "started"), id, append(f.runs, run)
	return f.err
}

func (f *fakeJobs) ApplyProcessed(_ context.Context, id uuid.UUID, run, n int32) error {
	f.calls, f.id, f.runs, f.count = append(f.calls, "processed"), id, append(f.runs, run), n
	return f.err
}

func (f *fakeJobs) ApplyFailed(_ context.Context, id uuid.UUID, run int32, why string) error {
	f.calls, f.id, f.runs, f.why = append(f.calls, "failed"), id, append(f.runs, run), why
	return f.err
}

func marshal(t *testing.T, msg proto.Message) []byte {
	t.Helper()
	data, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestApplyDecodesEachEvent(t *testing.T) {
	id := uuid.New()
	jobs := &fakeJobs{}
	if err := apply(t.Context(), jobs, SubjectStarted, marshal(t, &ingestionv1.ProcessingStarted{JobId: id.String(), Run: 1})); err != nil {
		t.Fatal(err)
	}
	progress := &ingestionv1.ProcessingProgress{JobId: id.String(), Run: 1, Stage: ingestionv1.JobStage_JOB_STAGE_EMBEDDING, Progress: 42}
	if err := apply(t.Context(), jobs, SubjectProgress, marshal(t, progress)); err != nil {
		t.Fatal(err)
	}
	if err := apply(t.Context(), jobs, SubjectProcessed, marshal(t, &ingestionv1.DocumentProcessed{JobId: id.String(), ChunkCount: 3, Run: 2})); err != nil {
		t.Fatal(err)
	}
	if err := apply(t.Context(), jobs, SubjectFailed, marshal(t, &ingestionv1.ProcessingFailed{JobId: id.String(), Error: "boom", Run: 3})); err != nil {
		t.Fatal(err)
	}
	if len(jobs.calls) != 4 || jobs.id != id || jobs.count != 3 || jobs.why != "boom" ||
		jobs.stage != ingestionv1.JobStage_JOB_STAGE_EMBEDDING || jobs.progress != 42 {
		t.Errorf("jobs = %+v", jobs)
	}
	if want := []int32{1, 1, 2, 3}; !slices.Equal(jobs.runs, want) {
		t.Errorf("runs = %v, want %v", jobs.runs, want)
	}
}

func TestApplyDropsMalformedJobIDs(t *testing.T) {
	for subject, msg := range map[string]proto.Message{
		SubjectStarted:   &ingestionv1.ProcessingStarted{JobId: "nope"},
		SubjectProgress:  &ingestionv1.ProcessingProgress{JobId: "nope"},
		SubjectProcessed: &ingestionv1.DocumentProcessed{JobId: "nope"},
		SubjectFailed:    &ingestionv1.ProcessingFailed{JobId: "nope"},
	} {
		jobs := &fakeJobs{}
		if err := apply(t.Context(), jobs, subject, marshal(t, msg)); err != nil {
			t.Errorf("%s: %v", subject, err)
		}
		if len(jobs.calls) != 0 {
			t.Errorf("%s: applied %v", subject, jobs.calls)
		}
	}
}

func TestApplyReturnsErrorsSoTheEventIsRedelivered(t *testing.T) {
	jobs := &fakeJobs{err: errors.New("database down")}
	err := apply(t.Context(), jobs, SubjectStarted, marshal(t, &ingestionv1.ProcessingStarted{JobId: uuid.NewString()}))
	if !errors.Is(err, jobs.err) {
		t.Fatalf("err = %v", err)
	}
	if err := apply(t.Context(), jobs, SubjectUploaded, nil); err == nil {
		t.Fatal("unexpected subject: want an error")
	}
}

type fakeSender struct {
	subject, id string
	msg         proto.Message
}

func (f *fakeSender) Publish(_ context.Context, subject string, msg proto.Message, id string) error {
	f.subject, f.msg, f.id = subject, msg, id
	return nil
}

func TestPublishUploaded(t *testing.T) {
	job := app.Job{ID: uuid.New(), DocumentID: uuid.New(), Filename: "a.md", ContentType: "text/markdown", Run: 2}
	sender := &fakeSender{}
	if err := NewPublisher(sender).PublishUploaded(t.Context(), job); err != nil {
		t.Fatal(err)
	}
	ev, ok := sender.msg.(*ingestionv1.DocumentUploaded)
	if sender.subject != SubjectUploaded || sender.id != job.ID.String()+":2" || !ok {
		t.Fatalf("sent %q %q %T", sender.subject, sender.id, sender.msg)
	}
	if ev.GetJobId() != job.ID.String() || ev.GetDocumentId() != job.DocumentID.String() || ev.GetFilename() != "a.md" || ev.GetContentType() != "text/markdown" || ev.GetRun() != 2 {
		t.Errorf("event = %v", ev)
	}
}
