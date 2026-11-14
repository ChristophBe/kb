package config

// Base holds settings every Go service understands.
type Base struct {
	// LogLevel is the lowest level logged.
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	// GRPCPort serves the gRPC API.
	GRPCPort int `env:"GRPC_PORT"`
	// MetricsPort serves Prometheus metrics.
	MetricsPort int `env:"METRICS_PORT"`
}
