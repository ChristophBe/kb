package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

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
