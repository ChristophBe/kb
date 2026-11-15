package config

import (
	"bytes"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"
)

type testConfig struct {
	Base
	DocumentAddr string `env:"DOCUMENT_ADDR" envDefault:"localhost:9001"`
	Nested       struct {
		Size int `env:"SIZE" envDefault:"1"`
	} `envPrefix:"NESTED_"`
}

func (c testConfig) Validate(p *Problems) {
	c.Base.Validate(p)
	p.Addr("KNOWCEL_DOCUMENT_ADDR", c.DocumentAddr)
	Positive(p, "KNOWCEL_NESTED_SIZE", c.Nested.Size)
}

func TestLoadReadsKnowcelPrefixedEnv(t *testing.T) {
	t.Setenv("KNOWCEL_GRPC_PORT", "9100")
	t.Setenv("KNOWCEL_LOG_LEVEL", "debug")

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

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	return &buf
}

func TestLoadAcceptsDeprecatedKBPrefixWithWarning(t *testing.T) {
	logs := captureLog(t)
	t.Setenv("KB_GRPC_PORT", "9100")
	t.Setenv("KB_DOCUMENT_ADDR", "doc:9001")

	cfg, err := Load[testConfig]()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9100 || cfg.DocumentAddr != "doc:9001" {
		t.Errorf("got port %d addr %q, want 9100 doc:9001", cfg.GRPCPort, cfg.DocumentAddr)
	}
	for _, v := range []string{"KB_GRPC_PORT", "KB_DOCUMENT_ADDR"} {
		if !strings.Contains(logs.String(), v) {
			t.Errorf("no deprecation warning for %s in %q", v, logs)
		}
	}
}

func TestLoadPrefersKnowcelOverDeprecatedKB(t *testing.T) {
	logs := captureLog(t)
	t.Setenv("KB_GRPC_PORT", "9100")
	t.Setenv("KNOWCEL_GRPC_PORT", "9200")

	cfg, err := Load[testConfig]()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9200 {
		t.Errorf("got port %d, want 9200", cfg.GRPCPort)
	}
	if !strings.Contains(logs.String(), "KB_GRPC_PORT") {
		t.Errorf("no warning about the ignored KB_GRPC_PORT in %q", logs)
	}
}

func TestLoadAppliesDefaultPorts(t *testing.T) {
	t.Setenv("KNOWCEL_GRPC_PORT", "9100")
	cfg, err := Load(func(c *testConfig) { c.DefaultPorts(9001, 9101) })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GRPCPort != 9100 || cfg.MetricsPort != 9101 {
		t.Errorf("ports = %d, %d; want 9100 (from env), 9101 (default)", cfg.GRPCPort, cfg.MetricsPort)
	}
}

// problems loads a testConfig and returns the problems it reports.
func problems(t *testing.T) []string {
	t.Helper()
	_, err := Load(func(c *testConfig) { c.DefaultPorts(9001, 9101) })
	var cfgErr *Error
	if !errors.As(err, &cfgErr) {
		t.Fatalf("err = %v, want *Error", err)
	}
	return cfgErr.Problems
}

func TestLoadReportsEveryUnparsableValue(t *testing.T) {
	t.Setenv("KNOWCEL_GRPC_PORT", "not-a-port")
	t.Setenv("KNOWCEL_NESTED_SIZE", "big")

	got := problems(t)
	want := []string{
		`KNOWCEL_GRPC_PORT: cannot parse as int: "not-a-port": invalid syntax`,
		`KNOWCEL_NESTED_SIZE: cannot parse as int: "big": invalid syntax`,
	}
	if !slices.Equal(got, want) {
		t.Errorf("problems = %q, want %q", got, want)
	}
}

func TestValidateReportsEveryRule(t *testing.T) {
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"log level":       {map[string]string{"KNOWCEL_LOG_LEVEL": "loud"}, `KNOWCEL_LOG_LEVEL: must be debug, info, warn or error, got "loud"`},
		"log format":      {map[string]string{"KNOWCEL_LOG_FORMAT": "xml"}, `KNOWCEL_LOG_FORMAT: must be one of json, text, got "xml"`},
		"grpc port":       {map[string]string{"KNOWCEL_GRPC_PORT": "70000"}, "KNOWCEL_GRPC_PORT: must be a port between 1 and 65535, got 70000"},
		"metrics port":    {map[string]string{"KNOWCEL_METRICS_PORT": "-1"}, "KNOWCEL_METRICS_PORT: must be a port between 1 and 65535, got -1"},
		"same ports":      {map[string]string{"KNOWCEL_METRICS_PORT": "9001"}, "KNOWCEL_METRICS_PORT: must differ from KNOWCEL_GRPC_PORT (both 9001)"},
		"otel scheme":     {map[string]string{"KNOWCEL_OTEL_ENDPOINT": "otel:4317"}, `KNOWCEL_OTEL_ENDPOINT: must be a URL with a host and scheme http or https, got "otel:4317"`},
		"peer address":    {map[string]string{"KNOWCEL_DOCUMENT_ADDR": "document"}, `KNOWCEL_DOCUMENT_ADDR: must be host:port, got "document"`},
		"positive number": {map[string]string{"KNOWCEL_NESTED_SIZE": "0"}, "KNOWCEL_NESTED_SIZE: must be positive, got 0"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			if got := problems(t); !slices.Equal(got, []string{c.want}) {
				t.Errorf("problems = %q, want %q", got, c.want)
			}
		})
	}
}

func TestValidateReportsAllProblemsTogether(t *testing.T) {
	t.Setenv("KNOWCEL_LOG_LEVEL", "loud")
	t.Setenv("KNOWCEL_OTEL_ENDPOINT", "otel:4317")
	t.Setenv("KNOWCEL_DOCUMENT_ADDR", "document")

	_, err := Load(func(c *testConfig) { c.DefaultPorts(9001, 9101) })
	if err == nil {
		t.Fatal("want an error")
	}
	msg := err.Error()
	for _, setting := range []string{"KNOWCEL_LOG_LEVEL", "KNOWCEL_OTEL_ENDPOINT", "KNOWCEL_DOCUMENT_ADDR"} {
		if !strings.Contains(msg, "\n  "+setting+": ") {
			t.Errorf("message lacks %s:\n%s", setting, msg)
		}
	}
	if !strings.HasPrefix(msg, "invalid configuration:\n") {
		t.Errorf("message = %q", msg)
	}
}

func TestValidAddressesAndURLs(t *testing.T) {
	var p Problems
	p.Addr("A", "document-service:9001")
	p.Addr("A", "[::1]:9001")
	p.URL("U", "https://collector.example.com:4317", "http", "https")
	p.OneOf("O", "text", "json", "text")
	if err := p.Err(); err != nil {
		t.Errorf("unexpected problems: %v", err)
	}
}
