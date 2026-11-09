package main

import (
	"slices"
	"testing"
	"time"

	"github.com/christoph/kb/platform/go/config"
)

func TestLimitsComeFromTheEnvironment(t *testing.T) {
	cfg, err := config.Load[Config]()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Limits.MaxUploadBytes != 50<<20 || !slices.Contains(cfg.Limits.AllowedContentTypes, "text/*") {
		t.Errorf("defaults = %+v", cfg.Limits)
	}
	t.Setenv("KB_MAX_UPLOAD_BYTES", "1024")
	t.Setenv("KB_ALLOWED_CONTENT_TYPES", "application/pdf,text/markdown")
	cfg, err = config.Load[Config]()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Limits.MaxUploadBytes != 1024 || !slices.Equal(cfg.Limits.AllowedContentTypes, []string{"application/pdf", "text/markdown"}) {
		t.Errorf("from env = %+v", cfg.Limits)
	}
}

func TestCleanupComesFromTheEnvironment(t *testing.T) {
	cfg, err := config.Load[Config]()
	if err != nil {
		t.Fatal(err)
	}
	if c := cfg.Cleanup; c.Interval != time.Hour || c.UploadTTL != 24*time.Hour || c.OrphanGrace != time.Hour {
		t.Errorf("defaults = %+v", c)
	}
	t.Setenv("KB_CLEANUP_INTERVAL", "1m")
	t.Setenv("KB_UPLOAD_TTL", "2m")
	t.Setenv("KB_ORPHAN_GRACE", "3m")
	cfg, err = config.Load[Config]()
	if err != nil {
		t.Fatal(err)
	}
	if c := cfg.Cleanup; c.Interval != time.Minute || c.UploadTTL != 2*time.Minute || c.OrphanGrace != 3*time.Minute {
		t.Errorf("from env = %+v", c)
	}
}
