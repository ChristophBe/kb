package config

import (
	"errors"
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
	p.Addr("KB_DOCUMENT_ADDR", c.DocumentAddr)
	Positive(p, "KB_NESTED_SIZE", c.Nested.Size)
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

func TestLoadAppliesDefaultPorts(t *testing.T) {
	t.Setenv("KB_GRPC_PORT", "9100")
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
	t.Setenv("KB_GRPC_PORT", "not-a-port")
	t.Setenv("KB_NESTED_SIZE", "big")

	got := problems(t)
	want := []string{
		`KB_GRPC_PORT: cannot parse as int: "not-a-port": invalid syntax`,
		`KB_NESTED_SIZE: cannot parse as int: "big": invalid syntax`,
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
		"log level":       {map[string]string{"KB_LOG_LEVEL": "loud"}, `KB_LOG_LEVEL: must be debug, info, warn or error, got "loud"`},
		"log format":      {map[string]string{"KB_LOG_FORMAT": "xml"}, `KB_LOG_FORMAT: must be one of json, text, got "xml"`},
		"grpc port":       {map[string]string{"KB_GRPC_PORT": "70000"}, "KB_GRPC_PORT: must be a port between 1 and 65535, got 70000"},
		"metrics port":    {map[string]string{"KB_METRICS_PORT": "-1"}, "KB_METRICS_PORT: must be a port between 1 and 65535, got -1"},
		"same ports":      {map[string]string{"KB_METRICS_PORT": "9001"}, "KB_METRICS_PORT: must differ from KB_GRPC_PORT (both 9001)"},
		"otel scheme":     {map[string]string{"KB_OTEL_ENDPOINT": "otel:4317"}, `KB_OTEL_ENDPOINT: must be a URL with a host and scheme http or https, got "otel:4317"`},
		"peer address":    {map[string]string{"KB_DOCUMENT_ADDR": "document"}, `KB_DOCUMENT_ADDR: must be host:port, got "document"`},
		"positive number": {map[string]string{"KB_NESTED_SIZE": "0"}, "KB_NESTED_SIZE: must be positive, got 0"},
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
	t.Setenv("KB_LOG_LEVEL", "loud")
	t.Setenv("KB_OTEL_ENDPOINT", "otel:4317")
	t.Setenv("KB_DOCUMENT_ADDR", "document")

	_, err := Load(func(c *testConfig) { c.DefaultPorts(9001, 9101) })
	if err == nil {
		t.Fatal("want an error")
	}
	msg := err.Error()
	for _, setting := range []string{"KB_LOG_LEVEL", "KB_OTEL_ENDPOINT", "KB_DOCUMENT_ADDR"} {
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
