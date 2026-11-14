// Package events defines the document module's JetStream stream and publishes
// its events.
package events

import (
	"context"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/platform/go/natsx"
)

const (
	Stream = "DOCUMENT"

	SubjectReindexRequested = "kb.document.reindex_requested"
)

// EnsureStream creates the module's stream.
func EnsureStream(ctx context.Context, js jetstream.JetStream) error {
	_, err := natsx.EnsureStream(ctx, js, Stream, "kb.document.>")
	return err
}

// Publisher sends events to JetStream.
type Publisher struct{ js jetstream.JetStream }

func NewPublisher(js jetstream.JetStream) *Publisher { return &Publisher{js: js} }

// PublishReindexRequested announces that a document should be embedded again.
// Every call is its own request (a random message id), since asking again is
// the way to reindex a document again.
func (p *Publisher) PublishReindexRequested(ctx context.Context, ev *documentv1.DocumentReindexRequested) error {
	data, err := proto.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = natsx.Publish(ctx, p.js, &nats.Msg{Subject: SubjectReindexRequested, Data: data},
		jetstream.WithMsgID(ev.GetDocumentId()+":"+uuid.NewString()))
	return err
}
