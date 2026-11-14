// Package config loads service configuration from KB_* environment variables
// into a struct using `env` tags, and validates it.
//
// The field comments of a config struct are its documentation:
// docs/configuration.md is generated from them (tools/modgen), together with
// the `env` and `envDefault` tags.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"reflect"
	"slices"
	"strconv"
	"strings"

	"github.com/caarlos0/env/v11"
)

// Base holds settings every Go service understands. Services embed it.
type Base struct {
	// LogLevel is the lowest level logged: debug, info, warn or error.
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	// LogFormat is the log output: json (one object per line) or text.
	LogFormat string `env:"LOG_FORMAT" envDefault:"json"`
	// GRPCPort serves the gRPC API; each service defaults it to the port in
	// its module.yaml.
	GRPCPort int `env:"GRPC_PORT"`
	// MetricsPort serves Prometheus metrics at /metrics (package metrics);
	// like KB_GRPC_PORT, each service defaults it to the port in its
	// module.yaml.
	MetricsPort int `env:"METRICS_PORT"`
	// OTelEndpoint is the OTLP/gRPC endpoint spans go to, e.g.
	// http://otel-collector:4317; tracing is off while it is empty.
	OTelEndpoint string `env:"OTEL_ENDPOINT"`
}

// DefaultPorts sets the ports left at 0 to the ones in the module.yaml.
func (b *Base) DefaultPorts(grpc, metrics int) {
	if b.GRPCPort == 0 {
		b.GRPCPort = grpc
	}
	if b.MetricsPort == 0 {
		b.MetricsPort = metrics
	}
}

// Validate checks the settings of Base. A service's Config that adds
// settings defines its own Validate, which calls this one.
func (b Base) Validate(p *Problems) {
	var level slog.Level
	if level.UnmarshalText([]byte(b.LogLevel)) != nil {
		p.Addf("KB_LOG_LEVEL", "must be debug, info, warn or error, got %q", b.LogLevel)
	}
	p.OneOf("KB_LOG_FORMAT", b.LogFormat, "json", "text")
	p.Port("KB_GRPC_PORT", b.GRPCPort)
	p.Port("KB_METRICS_PORT", b.MetricsPort)
	if b.GRPCPort != 0 && b.GRPCPort == b.MetricsPort {
		p.Addf("KB_METRICS_PORT", "must differ from KB_GRPC_PORT (both %d)", b.GRPCPort)
	}
	if b.OTelEndpoint != "" {
		p.URL("KB_OTEL_ENDPOINT", b.OTelEndpoint, "http", "https")
	}
}

// Validator is a config that checks its own settings; Load calls Validate.
type Validator interface {
	Validate(p *Problems)
}

// Load parses environment variables prefixed with KB_ into a T, applies
// defaults (e.g. Base.DefaultPorts) and, if T is a Validator, validates the
// result. The error is an *Error listing every problem found: all values that
// do not parse, or else everything Validate reports.
func Load[T any](defaults ...func(*T)) (T, error) {
	cfg, err := env.ParseAsWithOptions[T](env.Options{Prefix: "KB_"})
	if err != nil {
		return cfg, parseProblems(reflect.TypeFor[T](), err)
	}
	for _, d := range defaults {
		d(&cfg)
	}
	if v, ok := any(&cfg).(Validator); ok {
		var p Problems
		v.Validate(&p)
		if err := p.Err(); err != nil {
			return cfg, err
		}
	}
	return cfg, nil
}

// Error is an invalid configuration: one line per problem, each starting
// with the setting it is about.
type Error struct {
	Problems []string
}

func (e *Error) Error() string {
	return "invalid configuration:\n  " + strings.Join(e.Problems, "\n  ")
}

// Problems collects what is wrong with a configuration, so that a service
// reports every problem at once rather than the first one.
type Problems struct {
	list []string
}

// Addf records a problem with setting (e.g. "KB_LOG_LEVEL").
func (p *Problems) Addf(setting, format string, args ...any) {
	p.list = append(p.list, setting+": "+fmt.Sprintf(format, args...))
}

// Err returns the problems as an *Error, or nil when there are none.
func (p *Problems) Err() error {
	if len(p.list) == 0 {
		return nil
	}
	return &Error{Problems: slices.Clone(p.list)}
}

// OneOf checks that value is one of options.
func (p *Problems) OneOf(setting, value string, options ...string) {
	if !slices.Contains(options, value) {
		p.Addf(setting, "must be one of %s, got %q", strings.Join(options, ", "), value)
	}
}

// Port checks a TCP port; 0 is allowed (the service picks its default).
func (p *Problems) Port(setting string, port int) {
	if port < 0 || port > 65535 {
		p.Addf(setting, "must be a port between 1 and 65535, got %d", port)
	}
}

// URL checks that value is an absolute URL with a host and one of schemes.
func (p *Problems) URL(setting, value string, schemes ...string) {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || !slices.Contains(schemes, u.Scheme) {
		p.Addf(setting, "must be a URL with a host and scheme %s, got %q", strings.Join(schemes, " or "), value)
	}
}

// Addr checks a host:port address such as a peer's KB_<MODULE>_ADDR.
func (p *Problems) Addr(setting, value string) {
	host, port, err := net.SplitHostPort(value)
	if n, perr := strconv.Atoi(port); err != nil || host == "" || perr != nil || n < 1 || n > 65535 {
		p.Addf(setting, "must be host:port, got %q", value)
	}
}

// Positive checks that a number is above zero.
func Positive[N int | int64 | float64](p *Problems, setting string, value N) {
	if value <= 0 {
		p.Addf(setting, "must be positive, got %v", value)
	}
}

// parseProblems turns env's parse errors into an *Error naming the
// variables, which env reports by struct field only.
func parseProblems(t reflect.Type, err error) error {
	keys := map[string][]string{}
	envKeys(t, "KB_", keys)
	var agg env.AggregateError
	if !errors.As(err, &agg) {
		return &Error{Problems: []string{err.Error()}}
	}
	var p Problems
	for _, e := range agg.Errors {
		var pe env.ParseError
		if errors.As(e, &pe) && len(keys[pe.Name]) > 0 {
			p.Addf(strings.Join(keys[pe.Name], " or "), "cannot parse as %s: %v", pe.Type, unwrapNum(pe.Err))
			continue
		}
		p.list = append(p.list, e.Error())
	}
	return p.Err()
}

// unwrapNum drops strconv's function name: `parsing "x": invalid syntax`.
func unwrapNum(err error) error {
	var ne *strconv.NumError
	if errors.As(err, &ne) {
		return fmt.Errorf("%q: %w", ne.Num, ne.Err)
	}
	return err
}

// envKeys maps the field names of struct type t to their variables, the way
// env derives them from the env and envPrefix tags.
func envKeys(t reflect.Type, prefix string, keys map[string][]string) {
	for i := range t.NumField() {
		f := t.Field(i)
		if name, _, _ := strings.Cut(f.Tag.Get("env"), ","); name != "" {
			keys[f.Name] = append(keys[f.Name], prefix+name)
			continue
		}
		if f.Type.Kind() == reflect.Struct {
			envKeys(f.Type, prefix+f.Tag.Get("envPrefix"), keys)
		}
	}
}
