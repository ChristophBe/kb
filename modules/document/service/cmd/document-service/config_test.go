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
	t.Setenv("KNOWCEL_MAX_UPLOAD_BYTES", "1024")
	t.Setenv("KNOWCEL_ALLOWED_CONTENT_TYPES", "application/pdf,text/markdown")
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
	t.Setenv("KNOWCEL_CLEANUP_INTERVAL", "1m")
	t.Setenv("KNOWCEL_UPLOAD_TTL", "20m")
	t.Setenv("KNOWCEL_ORPHAN_GRACE", "3m")
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
		"KNOWCEL_DATABASE_URL":          "mysql://db/kb",
		"KNOWCEL_S3_ENDPOINT":           "http://s3:8333",
		"KNOWCEL_S3_BUCKET":             "Documents",
		"KNOWCEL_LLM_ADDR":              "llm",
		"KNOWCEL_MAX_UPLOAD_BYTES":      "-1",
		"KNOWCEL_ALLOWED_CONTENT_TYPES": "application/pdf,pdf,text/*",
		"KNOWCEL_CLEANUP_INTERVAL":      "-1m",
		"KNOWCEL_UPLOAD_TTL":            "10m",
		"KNOWCEL_ORPHAN_GRACE":          "-1s",
	} {
		t.Setenv(k, v)
	}
	_, err := loadConfig()
	var cfgErr *config.Error
	if !errors.As(err, &cfgErr) {
		t.Fatalf("err = %v, want *config.Error", err)
	}
	want := []string{
		`KNOWCEL_DATABASE_URL: must be a URL with a host and scheme postgres or postgresql, got "mysql://db/kb"`,
		`KNOWCEL_S3_ENDPOINT: must be host or host:port without a scheme, got "http://s3:8333"`,
		`KNOWCEL_S3_BUCKET: must be a bucket name (3-63 lowercase letters, digits, dots, hyphens), got "Documents"`,
		`KNOWCEL_LLM_ADDR: must be host:port, got "llm"`,
		"KNOWCEL_MAX_UPLOAD_BYTES: must be positive, got -1",
		`KNOWCEL_ALLOWED_CONTENT_TYPES: "pdf" is not a media type (type/subtype) or a wildcard (type/*)`,
		"KNOWCEL_CLEANUP_INTERVAL: must not be negative (0 turns cleanup off), got -1m0s",
		"KNOWCEL_UPLOAD_TTL: must be longer than upload URLs stay valid (15m0s), got 10m0s",
		"KNOWCEL_ORPHAN_GRACE: must not be negative, got -1s",
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
	for _, setting := range []string{"KNOWCEL_S3_ACCESS_KEY", "KNOWCEL_S3_SECRET_KEY", "KNOWCEL_S3_REGION", "KNOWCEL_ALLOWED_CONTENT_TYPES"} {
		if err == nil || !strings.Contains(err.Error(), setting+": ") {
			t.Errorf("%s not reported: %v", setting, err)
		}
	}
}
