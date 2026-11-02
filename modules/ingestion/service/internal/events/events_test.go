package events

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
)

type fakeJobs struct {
	calls []string
	id    uuid.UUID
	count int32
	why   string
	err   error
}

func (f *fakeJobs) ApplyStarted(_ context.Context, id uuid.UUID) error {
	f.calls, f.id = append(f.calls, "started"), id
	return f.err
}

func (f *fakeJobs) ApplyProcessed(_ context.Context, id uuid.UUID, n int32) error {
	f.calls, f.id, f.count = append(f.calls, "processed"), id, n
	return f.err
}

func (f *fakeJobs) ApplyFailed(_ context.Context, id uuid.UUID, why string) error {
	f.calls, f.id, f.why = append(f.calls, "failed"), id, why
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
	if err := apply(t.Context(), jobs, SubjectStarted, marshal(t, &ingestionv1.ProcessingStarted{JobId: id.String()})); err != nil {
		t.Fatal(err)
	}
	if err := apply(t.Context(), jobs, SubjectProcessed, marshal(t, &ingestionv1.DocumentProcessed{JobId: id.String(), ChunkCount: 3})); err != nil {
		t.Fatal(err)
	}
	if err := apply(t.Context(), jobs, SubjectFailed, marshal(t, &ingestionv1.ProcessingFailed{JobId: id.String(), Error: "boom"})); err != nil {
		t.Fatal(err)
	}
	if len(jobs.calls) != 3 || jobs.id != id || jobs.count != 3 || jobs.why != "boom" {
		t.Errorf("jobs = %+v", jobs)
	}
}

func TestApplyDropsMalformedJobIDs(t *testing.T) {
	for subject, msg := range map[string]proto.Message{
		SubjectStarted:   &ingestionv1.ProcessingStarted{JobId: "nope"},
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
	job := app.Job{ID: uuid.New(), DocumentID: uuid.New(), Filename: "a.md", ContentType: "text/markdown"}
	sender := &fakeSender{}
	if err := NewPublisher(sender).PublishUploaded(t.Context(), job); err != nil {
		t.Fatal(err)
	}
	ev, ok := sender.msg.(*ingestionv1.DocumentUploaded)
	if sender.subject != SubjectUploaded || sender.id != job.ID.String() || !ok {
		t.Fatalf("sent %q %q %T", sender.subject, sender.id, sender.msg)
	}
	if ev.GetJobId() != job.ID.String() || ev.GetDocumentId() != job.DocumentID.String() || ev.GetFilename() != "a.md" || ev.GetContentType() != "text/markdown" {
		t.Errorf("event = %v", ev)
	}
}
