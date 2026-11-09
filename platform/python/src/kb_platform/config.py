from pydantic_settings import BaseSettings, SettingsConfigDict


class PlatformSettings(BaseSettings):
    """Settings every component understands. Components subclass this and add
    their own fields; all values come from KB_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="KB_", extra="ignore")

    log_level: str = "INFO"
    log_format: str = "json"  # json | text
    grpc_port: int = 0
    # Serves Prometheus metrics at /metrics (kb_platform.metrics); like
    # grpc_port, each component defaults it to the port in its module.yaml.
    metrics_port: int = 0
    nats_url: str = "nats://localhost:4222"
    # OTLP/gRPC endpoint spans go to, e.g. http://otel-collector:4317; tracing
    # is off while it is empty (kb_platform.telemetry).
    otel_endpoint: str = ""
