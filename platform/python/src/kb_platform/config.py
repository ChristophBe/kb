from pydantic_settings import BaseSettings, SettingsConfigDict


class PlatformSettings(BaseSettings):
    """Settings every component understands. Components subclass this and add
    their own fields; all values come from KB_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="KB_", extra="ignore")

    log_level: str = "INFO"
    log_format: str = "json"  # json | text
    grpc_port: int = 0
    nats_url: str = "nats://localhost:4222"
