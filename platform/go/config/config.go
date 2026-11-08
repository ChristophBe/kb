// Package config loads service configuration from KB_* environment variables
// into a struct using `env` tags.
package config

import "github.com/caarlos0/env/v11"

// Base holds settings every Go service understands. Services embed it.
type Base struct {
	LogLevel  string `env:"LOG_LEVEL" envDefault:"info"`
	LogFormat string `env:"LOG_FORMAT" envDefault:"json"`
	GRPCPort  int    `env:"GRPC_PORT"`
	// OTelEndpoint is the OTLP/gRPC endpoint spans go to, e.g.
	// http://otel-collector:4317; tracing is off while it is empty.
	OTelEndpoint string `env:"OTEL_ENDPOINT"`
}

// Load parses environment variables prefixed with KB_ into a T.
func Load[T any]() (T, error) {
	return env.ParseAsWithOptions[T](env.Options{Prefix: "KB_"})
}
