package natsx

import (
	"context"
	"testing"

	"github.com/nats-io/nats.go"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// The Python components read and write the lower-case W3C header names, so
// the carrier must not canonicalise them as HTTP headers would.
func TestHeaderCarrierKeepsW3CNames(t *testing.T) {
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1}, SpanID: trace.SpanID{2}, TraceFlags: trace.FlagsSampled,
	})
	h := nats.Header{}
	propagation.TraceContext{}.Inject(trace.ContextWithSpanContext(context.Background(), sc), headerCarrier(h))
	if got := h.Get("traceparent"); got != "00-01000000000000000000000000000000-0200000000000000-01" {
		t.Errorf("traceparent header = %q (headers %v)", got, h)
	}
	got := trace.SpanContextFromContext(propagation.TraceContext{}.Extract(context.Background(), headerCarrier(h)))
	if got.TraceID() != sc.TraceID() || got.SpanID() != sc.SpanID() {
		t.Errorf("extracted %v, want %v", got, sc)
	}
}
