// Package events defines the ingestion module's JetStream stream, publishes
// its events and hands processing events to the use cases.
package events

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
	"github.com/ChristophBe/knowcelium/modules/ingestion/service/internal/app"
	"github.com/ChristophBe/knowcelium/platform/go/natsx"
)

const (
	Stream = "INGESTION"

	SubjectUploaded  = "knowcel.ingestion.uploaded"
	SubjectStarted   = "knowcel.ingestion.started"
	SubjectProgress  = "knowcel.ingestion.progress"
	SubjectProcessed = "knowcel.ingestion.processed"
	SubjectFailed    = "knowcel.ingestion.failed"

	consumerName = "ingestion-service"

	// The document module's stream and the subject that asks for a reindex.
	documentStream          = "DOCUMENT"
	SubjectReindexRequested = "knowcel.document.reindex_requested"
	reindexConsumerName     = "ingestion-service-reindex"
	// A reindex that finds its document busy is tried again after this long,
	// up to reindexMaxDeliver times.
	reindexRetryDelay  = 15 * time.Second
	reindexMaxDeliver  = 40
	streamLookupPeriod = 5 * time.Second
)

// Sender sends one event. msgID deduplicates retries server-side.
type Sender interface {
	Publish(ctx context.Context, subject string, msg proto.Message, msgID string) error
}

// JetStream sends protobuf events to JetStream.
type JetStream struct{ js jetstream.JetStream }

func NewJetStream(js jetstream.JetStream) *JetStream { return &JetStream{js: js} }

func (j *JetStream) Publish(ctx context.Context, subject string, msg proto.Message, msgID string) error {
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = natsx.Publish(ctx, j.js, &nats.Msg{Subject: subject, Data: data}, jetstream.WithMsgID(msgID))
	return err
}

// Publisher implements app.Publisher.
type Publisher struct{ sender Sender }

func NewPublisher(sender Sender) *Publisher { return &Publisher{sender: sender} }

func (p *Publisher) PublishUploaded(ctx context.Context, job app.Job) error {
	return p.sender.Publish(ctx, SubjectUploaded, &ingestionv1.DocumentUploaded{
		JobId:       job.ID.String(),
		DocumentId:  job.DocumentID.String(),
		Filename:    job.Filename,
		ContentType: job.ContentType,
		Run:         job.Run,
	}, fmt.Sprintf("%s:%d", job.ID, job.Run))
}

// EnsureStream creates the module's stream.
func EnsureStream(ctx context.Context, js jetstream.JetStream) error {
	_, err := natsx.EnsureStream(ctx, js, Stream, "knowcel.ingestion.>")
	return err
}

// Jobs receives the processing events.
type Jobs interface {
	ApplyStarted(ctx context.Context, id uuid.UUID, run int32) error
	ApplyProgress(ctx context.Context, id uuid.UUID, run int32, stage ingestionv1.JobStage, progress int32) error
	ApplyProcessed(ctx context.Context, id uuid.UUID, run, chunkCount int32) error
	ApplyFailed(ctx context.Context, id uuid.UUID, run int32, reason string) error
}

// Consume applies started/progress/processed/failed events to jobs until ctx ends.
func Consume(ctx context.Context, js jetstream.JetStream, jobs Jobs, log *slog.Logger) error {
	cons, err := js.CreateOrUpdateConsumer(ctx, Stream, jetstream.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{SubjectStarted, SubjectProgress, SubjectProcessed, SubjectFailed},
		AckPolicy:      jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return err
	}
	cc, err := cons.Consume(func(msg jetstream.Msg) {
		ctx, end := natsx.Receive(ctx, msg)
		err := apply(ctx, jobs, msg.Subject(), msg.Data())
		end(err)
		if err != nil {
			log.ErrorContext(ctx, "apply event", "subject", msg.Subject(), "error", err)
			_ = msg.Nak()
			return
		}
		_ = msg.Ack()
	})
	if err != nil {
		return err
	}
	<-ctx.Done()
	cc.Stop()
	return nil
}

func apply(ctx context.Context, jobs Jobs, subject string, data []byte) error {
	switch subject {
	case SubjectStarted:
		var ev ingestionv1.ProcessingStarted
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		id, err := uuid.Parse(ev.GetJobId())
		if err != nil {
			return nil //nolint:nilerr // malformed events can never succeed; drop them
		}
		return jobs.ApplyStarted(ctx, id, ev.GetRun())
	case SubjectProgress:
		var ev ingestionv1.ProcessingProgress
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		id, err := uuid.Parse(ev.GetJobId())
		if err != nil {
			return nil //nolint:nilerr // malformed events can never succeed; drop them
		}
		return jobs.ApplyProgress(ctx, id, ev.GetRun(), ev.GetStage(), ev.GetProgress())
	case SubjectProcessed:
		var ev ingestionv1.DocumentProcessed
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		id, err := uuid.Parse(ev.GetJobId())
		if err != nil {
			return nil //nolint:nilerr // malformed events can never succeed; drop them
		}
		return jobs.ApplyProcessed(ctx, id, ev.GetRun(), ev.GetChunkCount())
	case SubjectFailed:
		var ev ingestionv1.ProcessingFailed
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		id, err := uuid.Parse(ev.GetJobId())
		if err != nil {
			return nil //nolint:nilerr // malformed events can never succeed; drop them
		}
		return jobs.ApplyFailed(ctx, id, ev.GetRun(), ev.GetError())
	default:
		return fmt.Errorf("unexpected subject %q", subject)
	}
}

// Reindexer reprocesses a document for its owner.
type Reindexer interface {
	ReindexDocument(ctx context.Context, owner string, documentID uuid.UUID) error
}

// ConsumeReindex reprocesses the documents the document module asks to be
// embedded again, until ctx ends. The document module owns the stream and may
// start after this service, so the consumer is created once the stream
// exists. A document that is busy is tried again later; the other errors are
// retried by redelivery too, at most reindexMaxDeliver times.
func ConsumeReindex(ctx context.Context, js jetstream.JetStream, reindexer Reindexer, log *slog.Logger) error {
	var cons jetstream.Consumer
	for {
		var err error
		cons, err = js.CreateOrUpdateConsumer(ctx, documentStream, jetstream.ConsumerConfig{
			Durable:        reindexConsumerName,
			FilterSubjects: []string{SubjectReindexRequested},
			AckPolicy:      jetstream.AckExplicitPolicy,
			MaxDeliver:     reindexMaxDeliver,
		})
		if err == nil {
			break
		}
		if !errors.Is(err, jetstream.ErrStreamNotFound) {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(streamLookupPeriod):
		}
	}
	cc, err := cons.Consume(func(msg jetstream.Msg) {
		ctx, end := natsx.Receive(ctx, msg)
		err := reindex(ctx, reindexer, msg.Data())
		end(err)
		switch {
		case errors.Is(err, app.ErrReindexBusy):
			if md, mdErr := msg.Metadata(); mdErr == nil && md.NumDelivered >= reindexMaxDeliver {
				log.ErrorContext(ctx, "reindex given up, the document stayed busy", "attempts", md.NumDelivered)
			}
			_ = msg.NakWithDelay(reindexRetryDelay)
		case err != nil:
			log.ErrorContext(ctx, "reindex document", "error", err)
			_ = msg.NakWithDelay(reindexRetryDelay)
		default:
			_ = msg.Ack()
		}
	})
	if err != nil {
		return err
	}
	<-ctx.Done()
	cc.Stop()
	return nil
}

func reindex(ctx context.Context, reindexer Reindexer, data []byte) error {
	var ev documentv1.DocumentReindexRequested
	if err := proto.Unmarshal(data, &ev); err != nil {
		return nil //nolint:nilerr // malformed events can never succeed; drop them
	}
	id, err := uuid.Parse(ev.GetDocumentId())
	if err != nil || ev.GetOwnerId() == "" {
		return nil //nolint:nilerr // likewise
	}
	return reindexer.ReindexDocument(ctx, ev.GetOwnerId(), id)
}
