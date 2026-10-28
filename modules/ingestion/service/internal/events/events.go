// Package events defines the ingestion module's JetStream stream and applies
// processing events to jobs.
package events

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/store"
	"github.com/christoph/kb/platform/go/natsx"
)

const (
	Stream = "INGESTION"

	SubjectUploaded  = "kb.ingestion.uploaded"
	SubjectStarted   = "kb.ingestion.started"
	SubjectProcessed = "kb.ingestion.processed"
	SubjectFailed    = "kb.ingestion.failed"

	consumerName = "ingestion-service"
)

// Publisher publishes protobuf events to JetStream.
type Publisher struct{ js jetstream.JetStream }

func NewPublisher(js jetstream.JetStream) *Publisher { return &Publisher{js: js} }

// Publish sends msg on subject. msgID deduplicates retries server-side.
func (p *Publisher) Publish(ctx context.Context, subject string, msg proto.Message, msgID string) error {
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = p.js.PublishMsg(ctx, &nats.Msg{Subject: subject, Data: data}, jetstream.WithMsgID(msgID))
	return err
}

// EnsureStream creates the module's stream.
func EnsureStream(ctx context.Context, js jetstream.JetStream) error {
	_, err := natsx.EnsureStream(ctx, js, Stream, "kb.ingestion.>")
	return err
}

// Consume applies started/processed/failed events to jobs until ctx ends.
func Consume(ctx context.Context, js jetstream.JetStream, repo store.Querier, log *slog.Logger) error {
	cons, err := js.CreateOrUpdateConsumer(ctx, Stream, jetstream.ConsumerConfig{
		Durable:        consumerName,
		FilterSubjects: []string{SubjectStarted, SubjectProcessed, SubjectFailed},
		AckPolicy:      jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return err
	}
	cc, err := cons.Consume(func(msg jetstream.Msg) {
		if err := apply(ctx, repo, msg.Subject(), msg.Data()); err != nil {
			log.Error("apply event", "subject", msg.Subject(), "error", err)
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

func apply(ctx context.Context, repo store.Querier, subject string, data []byte) error {
	var (
		jobID  string
		params store.AdvanceJobParams
	)
	switch subject {
	case SubjectStarted:
		var ev ingestionv1.ProcessingStarted
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		jobID = ev.GetJobId()
		params.Status = int16(ingestionv1.JobStatus_JOB_STATUS_PROCESSING)
	case SubjectProcessed:
		var ev ingestionv1.DocumentProcessed
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		jobID = ev.GetJobId()
		params.Status = int16(ingestionv1.JobStatus_JOB_STATUS_DONE)
		params.ChunkCount = ev.GetChunkCount()
	case SubjectFailed:
		var ev ingestionv1.ProcessingFailed
		if err := proto.Unmarshal(data, &ev); err != nil {
			return err
		}
		jobID = ev.GetJobId()
		params.Status = int16(ingestionv1.JobStatus_JOB_STATUS_FAILED)
		params.Error = ev.GetError()
	default:
		return fmt.Errorf("unexpected subject %q", subject)
	}
	id, err := uuid.Parse(jobID)
	if err != nil {
		return nil //nolint:nilerr // malformed events can never succeed; drop them
	}
	params.ID = id
	if _, err := repo.AdvanceJob(ctx, params); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}
