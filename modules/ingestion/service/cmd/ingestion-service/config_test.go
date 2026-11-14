package main

import (
	"errors"
	"slices"
	"testing"

	"github.com/christoph/kb/platform/go/config"
)

func TestDefaultConfigIsValid(t *testing.T) {
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9002 || cfg.MetricsPort != 9102 {
		t.Errorf("ports = %d, %d; want the module.yaml ports", cfg.GRPCPort, cfg.MetricsPort)
	}
}

func TestNATSClusterURLsAreValid(t *testing.T) {
	t.Setenv("KB_NATS_URL", "nats://a:4222, tls://b:4222")
	if _, err := loadConfig(); err != nil {
		t.Fatal(err)
	}
}

func TestInvalidConfigListsEveryProblem(t *testing.T) {
	t.Setenv("KB_DATABASE_URL", "kb")
	t.Setenv("KB_NATS_URL", "http://nats:4222")
	t.Setenv("KB_DOCUMENT_ADDR", "document-service")
	t.Setenv("KB_METRICS_PORT", "9002")
	_, err := loadConfig()
	var cfgErr *config.Error
	if !errors.As(err, &cfgErr) {
		t.Fatalf("err = %v, want *config.Error", err)
	}
	want := []string{
		"KB_METRICS_PORT: must differ from KB_GRPC_PORT (both 9002)",
		`KB_DATABASE_URL: must be a URL with a host and scheme postgres or postgresql, got "kb"`,
		`KB_NATS_URL: must be a URL with a host and scheme nats or tls or ws or wss, got "http://nats:4222"`,
		`KB_DOCUMENT_ADDR: must be host:port, got "document-service"`,
	}
	if !slices.Equal(cfgErr.Problems, want) {
		t.Errorf("problems = %q\nwant %q", cfgErr.Problems, want)
	}
}
