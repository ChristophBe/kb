package embedcheck

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
)

// fakeLLM is unavailable for the first `down` calls, then reports dims.
type fakeLLM struct {
	down, calls int
	dims        int32
}

func (f *fakeLLM) GetProviderStatus(context.Context, *llmv1.GetProviderStatusRequest, ...grpc.CallOption) (*llmv1.GetProviderStatusResponse, error) {
	f.calls++
	if f.calls <= f.down {
		return nil, status.Error(codes.Unavailable, "llm down")
	}
	return &llmv1.GetProviderStatusResponse{EmbeddingDimensions: f.dims}, nil
}

var fast = Backoff{Initial: time.Millisecond, Max: 2 * time.Millisecond}

func run(t *testing.T, ctx context.Context, llm *fakeLLM) (bool, string) {
	t.Helper()
	var out bytes.Buffer
	ok := Run(ctx, 768, llm, fast, slog.New(slog.NewTextHandler(&out, nil)))
	return ok, out.String()
}

func TestRunWaitsForLLMAndAcceptsAMatch(t *testing.T) {
	llm := &fakeLLM{down: 3, dims: 768}
	ok, logs := run(t, t.Context(), llm)
	if !ok || llm.calls != 4 {
		t.Errorf("ok = %v after %d calls, want true after 4", ok, llm.calls)
	}
	if !strings.Contains(logs, "level=INFO") || strings.Contains(logs, "level=ERROR") {
		t.Errorf("logs = %s", logs)
	}
}

func TestRunLogsAMismatch(t *testing.T) {
	ok, logs := run(t, t.Context(), &fakeLLM{dims: 1024})
	if ok {
		t.Error("ok = true, want false for 1024 vs 768")
	}
	for _, want := range []string{"level=ERROR", "llm_dimensions=1024", "column_dimensions=768", "KB_EMBEDDING_DIMENSIONS"} {
		if !strings.Contains(logs, want) {
			t.Errorf("logs lack %q: %s", want, logs)
		}
	}
}

func TestRunStopsWithTheContext(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	ok, logs := run(t, ctx, &fakeLLM{down: 1 << 30})
	if ok || strings.Contains(logs, "level=ERROR") {
		t.Errorf("ok = %v, logs = %s; want false and no error while llm stays down", ok, logs)
	}
}
