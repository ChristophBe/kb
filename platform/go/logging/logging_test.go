package logging

import (
	"context"
	"log/slog"
	"testing"
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
