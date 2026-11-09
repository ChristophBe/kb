// Package natsx connects to NATS and manages JetStream streams. With tracing
// on (see package telemetry), Publish and Receive carry the trace of a request
// across messages in their W3C trace context headers.
package natsx

import (
	"context"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/christoph/kb/platform/go/telemetry"
)

const tracerName = "github.com/christoph/kb/platform/go/natsx"

// Connect opens a NATS connection that reconnects forever.
func Connect(url, name string) (*nats.Conn, jetstream.JetStream, error) {
	nc, err := nats.Connect(url, nats.Name(name), nats.MaxReconnects(-1))
	if err != nil {
		return nil, nil, err
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, nil, err
	}
	return nc, js, nil
}

// EnsureStream creates or updates a stream. Streams are owned by the module
// whose subjects they carry.
func EnsureStream(ctx context.Context, js jetstream.JetStream, name string, subjects ...string) (jetstream.Stream, error) {
	return js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{Name: name, Subjects: subjects})
}

// Publish sends msg to JetStream. With tracing on it does so in a producer
// span whose context goes into the message's headers, so that the consumer
// continues the trace (see Receive).
func Publish(ctx context.Context, js jetstream.JetStream, msg *nats.Msg, opts ...jetstream.PublishOpt) (*jetstream.PubAck, error) {
	if !telemetry.Enabled() {
		return js.PublishMsg(ctx, msg, opts...)
	}
	ctx, span := otel.Tracer(tracerName).Start(ctx, "send "+msg.Subject,
		trace.WithSpanKind(trace.SpanKindProducer), trace.WithAttributes(messagingAttrs(msg.Subject, "send")...))
	defer span.End()
	if msg.Header == nil {
		msg.Header = nats.Header{}
	}
	otel.GetTextMapPropagator().Inject(ctx, headerCarrier(msg.Header))
	ack, err := js.PublishMsg(ctx, msg, opts...)
	if err != nil {
		span.SetStatus(codes.Error, err.Error())
	}
	return ack, err
}

// Receive starts handling msg: with tracing on, the returned context is in a
// consumer span continuing the publisher's trace, and end, called with the
// handling's error, ends the span. With tracing off it returns ctx unchanged.
func Receive(ctx context.Context, msg jetstream.Msg) (_ context.Context, end func(error)) {
	if !telemetry.Enabled() {
		return ctx, func(error) {}
	}
	ctx = otel.GetTextMapPropagator().Extract(ctx, headerCarrier(msg.Headers()))
	ctx, span := otel.Tracer(tracerName).Start(ctx, "process "+msg.Subject(),
		trace.WithSpanKind(trace.SpanKindConsumer), trace.WithAttributes(messagingAttrs(msg.Subject(), "process")...))
	return ctx, func(err error) {
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}

func messagingAttrs(subject, operation string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.String("messaging.system", "nats"),
		attribute.String("messaging.destination.name", subject),
		attribute.String("messaging.operation.type", operation),
	}
}

// headerCarrier carries trace context in NATS headers. Unlike HTTP headers
// they are case-sensitive, so the keys are kept as the propagator writes them
// (lower case, as in the Python components).
type headerCarrier nats.Header

func (c headerCarrier) Get(key string) string {
	if v := c[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}

func (c headerCarrier) Set(key, value string) { c[key] = []string{value} }

func (c headerCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}
