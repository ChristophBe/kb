package config

import "testing"

type testConfig struct {
	Base
	DocumentAddr string `env:"DOCUMENT_ADDR" envDefault:"localhost:9001"`
}

func TestLoadReadsKBPrefixedEnv(t *testing.T) {
	t.Setenv("KB_GRPC_PORT", "9100")
	t.Setenv("KB_LOG_LEVEL", "debug")

	cfg, err := Load[testConfig]()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9100 || cfg.LogLevel != "debug" {
		t.Errorf("got port %d level %q, want 9100 debug", cfg.GRPCPort, cfg.LogLevel)
	}
	if cfg.LogFormat != "json" || cfg.DocumentAddr != "localhost:9001" {
		t.Errorf("defaults not applied: %+v", cfg)
	}
}

func TestLoadRejectsInvalidValue(t *testing.T) {
	t.Setenv("KB_GRPC_PORT", "not-a-port")

	if _, err := Load[testConfig](); err == nil {
		t.Fatal("want error for non-numeric port")
	}
}
