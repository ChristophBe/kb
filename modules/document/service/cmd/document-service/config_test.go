package main

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ChristophBe/knowcelium/platform/go/config"
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
	t.Setenv("KB_UPLOAD_TTL", "20m")
	t.Setenv("KB_ORPHAN_GRACE", "3m")
	cfg, err = config.Load[Config]()
	if err != nil {
		t.Fatal(err)
	}
	if c := cfg.Cleanup; c.Interval != time.Minute || c.UploadTTL != 20*time.Minute || c.OrphanGrace != 3*time.Minute {
		t.Errorf("from env = %+v", c)
	}
}

func TestDefaultConfigIsValid(t *testing.T) {
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9001 || cfg.MetricsPort != 9101 {
		t.Errorf("ports = %d, %d; want the module.yaml ports", cfg.GRPCPort, cfg.MetricsPort)
	}
}

func TestInvalidConfigListsEveryProblem(t *testing.T) {
	for k, v := range map[string]string{
		"KB_DATABASE_URL":          "mysql://db/kb",
		"KB_S3_ENDPOINT":           "http://s3:8333",
		"KB_S3_BUCKET":             "Documents",
		"KB_LLM_ADDR":              "llm",
		"KB_MAX_UPLOAD_BYTES":      "-1",
		"KB_ALLOWED_CONTENT_TYPES": "application/pdf,pdf,text/*",
		"KB_CLEANUP_INTERVAL":      "-1m",
		"KB_UPLOAD_TTL":            "10m",
		"KB_ORPHAN_GRACE":          "-1s",
	} {
		t.Setenv(k, v)
	}
	_, err := loadConfig()
	var cfgErr *config.Error
	if !errors.As(err, &cfgErr) {
		t.Fatalf("err = %v, want *config.Error", err)
	}
	want := []string{
		`KB_DATABASE_URL: must be a URL with a host and scheme postgres or postgresql, got "mysql://db/kb"`,
		`KB_S3_ENDPOINT: must be host or host:port without a scheme, got "http://s3:8333"`,
		`KB_S3_BUCKET: must be a bucket name (3-63 lowercase letters, digits, dots, hyphens), got "Documents"`,
		`KB_LLM_ADDR: must be host:port, got "llm"`,
		"KB_MAX_UPLOAD_BYTES: must be positive, got -1",
		`KB_ALLOWED_CONTENT_TYPES: "pdf" is not a media type (type/subtype) or a wildcard (type/*)`,
		"KB_CLEANUP_INTERVAL: must not be negative (0 turns cleanup off), got -1m0s",
		"KB_UPLOAD_TTL: must be longer than upload URLs stay valid (15m0s), got 10m0s",
		"KB_ORPHAN_GRACE: must not be negative, got -1s",
	}
	if !slices.Equal(cfgErr.Problems, want) {
		t.Errorf("problems:\n%s\nwant:\n%s", strings.Join(cfgErr.Problems, "\n"), strings.Join(want, "\n"))
	}
}

func TestS3CredentialsAreRequired(t *testing.T) {
	var p config.Problems
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	cfg.Storage.AccessKey, cfg.Storage.SecretKey, cfg.Storage.Region = "", "", ""
	cfg.Limits.AllowedContentTypes = nil
	cfg.Validate(&p)
	err = p.Err()
	for _, setting := range []string{"KB_S3_ACCESS_KEY", "KB_S3_SECRET_KEY", "KB_S3_REGION", "KB_ALLOWED_CONTENT_TYPES"} {
		if err == nil || !strings.Contains(err.Error(), setting+": ") {
			t.Errorf("%s not reported: %v", setting, err)
		}
	}
}
