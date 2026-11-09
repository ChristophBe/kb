// Package telemetry turns on OpenTelemetry tracing. Tracing is off unless
// KB_OTEL_ENDPOINT is set: then spans go to that OTLP/gRPC endpoint and the
// grpcserver, postgres and natsx packages instrument what they build. While it
// is off nothing is installed, so instrumentation costs nothing.
package telemetry

import (
	"context"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/christoph/kb/platform/go/version"
)

var enabled atomic.Bool

// Enabled reports whether tracing is on, i.e. Setup or Install ran.
func Enabled() bool { return enabled.Load() }

// Setup exports the spans of service to the OTLP/gRPC endpoint, a URL such
// as http://otel-collector:4317. With an empty endpoint it does nothing. Call
// it before building servers, clients and pools, and call the returned
// function on exit to flush the spans still buffered (for up to five seconds).
func Setup(ctx context.Context, endpoint, service string) (shutdown func(), err error) {
	if endpoint == "" {
		return func() {}, nil
	}
	exporter, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpointURL(endpoint))
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName(service),
		semconv.ServiceVersion(version.Version),
	))
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	Install(tp)
	return func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = tp.Shutdown(ctx)
	}, nil
}

// Install makes tp the process's tracer provider, propagates W3C trace
// context and turns instrumentation on. Setup calls it; tests pass a provider
// that records spans.
func Install(tp trace.TracerProvider) {
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	enabled.Store(true)
}
