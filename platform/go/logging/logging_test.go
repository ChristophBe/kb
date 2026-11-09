package logging

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"

	"github.com/christoph/kb/platform/go/version"
)

func TestSetupLevel(t *testing.T) {
	for _, tc := range []struct {
		level string
		want  slog.Level
	}{
		{"debug", slog.LevelDebug},
		{"WARN", slog.LevelWarn},
		{"bogus", slog.LevelInfo},
	} {
		log := Setup(tc.level, "text", "test")
		if !log.Enabled(context.Background(), tc.want) || log.Enabled(context.Background(), tc.want-1) {
			t.Errorf("Setup(%q): want minimum level %v", tc.level, tc.want)
		}
	}
}

func TestSetupLogsVersion(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr := os.Stderr
	os.Stderr = w
	t.Cleanup(func() { os.Stderr = stderr })
	version.Version = "1.2.3"
	Setup("info", "text", "test")
	_ = w.Close()
	out, _ := io.ReadAll(r)
	if !strings.Contains(string(out), "msg=starting service=test version=1.2.3") {
		t.Errorf("startup log = %q, want the version", out)
	}
}

func TestTraceHandlerAddsTraceIDs(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(traceHandler{slog.NewTextHandler(&buf, nil)}).With("service", "test")
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1}, SpanID: trace.SpanID{2}, TraceFlags: trace.FlagsSampled,
	})
	log.InfoContext(trace.ContextWithSpanContext(context.Background(), sc), "in span")
	log.InfoContext(context.Background(), "outside")

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if want := "trace_id=" + sc.TraceID().String() + " span_id=" + sc.SpanID().String(); !strings.Contains(lines[0], want) {
		t.Errorf("log line in a span = %q, want %q", lines[0], want)
	}
	if strings.Contains(lines[1], "trace_id") {
		t.Errorf("log line outside a span = %q, want no trace id", lines[1])
	}
}
