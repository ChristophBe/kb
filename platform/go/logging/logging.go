// Package logging configures the process-wide slog logger.
package logging

import (
	"log/slog"
	"os"
	"strings"

	"github.com/christoph/kb/platform/go/version"
)

// Setup installs and returns a slog logger and logs the release version the
// service runs. format is "json" or "text".
func Setup(level, format, service string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
		lvl = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: lvl}
	var h slog.Handler = slog.NewJSONHandler(os.Stderr, opts)
	if format == "text" {
		h = slog.NewTextHandler(os.Stderr, opts)
	}
	logger := slog.New(h).With("service", service)
	slog.SetDefault(logger)
	logger.Info("starting", "version", version.Version)
	return logger
}
