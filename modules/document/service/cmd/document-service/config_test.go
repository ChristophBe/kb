package main

import (
	"slices"
	"testing"

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
