package telemetry

import (
	"runtime"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// TestSetupWithoutEndpointDoesNothing must run before the tests that turn
// tracing on: they change process-wide state.
func TestSetupWithoutEndpointDoesNothing(t *testing.T) {
	before := runtime.NumGoroutine()
	shutdown, err := Setup(t.Context(), "", "test")
	if err != nil {
		t.Fatal(err)
	}
	shutdown()
	if Enabled() {
		t.Error("Enabled() = true without an endpoint")
	}
	if _, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); ok {
		t.Error("an SDK tracer provider was installed without an endpoint")
	}
	if after := runtime.NumGoroutine(); after != before {
		t.Errorf("goroutines: %d before Setup, %d after; want no background work", before, after)
	}
}

func TestSetupWithEndpointInstallsTracing(t *testing.T) {
	// Nothing listens there; the exporter connects lazily, so Setup succeeds.
	shutdown, err := Setup(t.Context(), "http://127.0.0.1:1", "test")
	if err != nil {
		t.Fatal(err)
	}
	defer shutdown()
	if !Enabled() {
		t.Error("Enabled() = false with an endpoint")
	}
	if _, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); !ok {
		t.Errorf("tracer provider = %T, want the SDK's", otel.GetTracerProvider())
	}
}
