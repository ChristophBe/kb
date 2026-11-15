"""Settings from KNOWCEL_* environment variables, and their validation.

The comment above a field (or at the end of its line) is its documentation:
docs/configuration.md is generated from it (tools/modgen), together with the
field's default. Components load their settings with `load_settings`, which
reports every problem at once and exits instead of raising a traceback.
"""

import logging
import math
import os
from collections.abc import Sequence
from urllib.parse import urlsplit

from pydantic import ValidationError
from pydantic_core import ErrorDetails
from pydantic_settings import BaseSettings, SettingsConfigDict


class Problems:
    """Collects what is wrong with the settings, so that a component reports
    every problem at once rather than the first one."""

    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, field: str, message: str) -> None:
        """Records a problem with the setting of `field` (e.g. "log_level")."""
        self.items.append(f"{env_name(field)}: {message}")

    def one_of(self, field: str, value: str, options: Sequence[str]) -> None:
        if value not in options:
            self.add(field, f"must be one of {', '.join(options)}, got {value!r}")

    def port(self, field: str, value: int) -> None:
        if not 1 <= value <= 65535:
            self.add(field, f"must be a port between 1 and 65535, got {value}")

    def url(self, field: str, value: str, schemes: Sequence[str]) -> None:
        """Checks an absolute URL with a host and one of `schemes`."""
        try:
            parts = urlsplit(value)
            ok = parts.scheme in schemes and bool(parts.hostname)
        except ValueError:
            ok = False
        if not ok:
            self.add(
                field, f"must be a URL with a host and scheme {' or '.join(schemes)}, got {value!r}"
            )

    def addr(self, field: str, value: str) -> None:
        """Checks a host:port address such as a peer's KNOWCEL_<MODULE>_ADDR."""
        host, _, port = value.rpartition(":")
        if not host or not port.isdigit() or not 1 <= int(port) <= 65535:
            self.add(field, f"must be host:port, got {value!r}")

    def at_least(self, field: str, value: float, minimum: float) -> None:
        if not value >= minimum or math.isinf(value):  # also catches NaN
            self.add(field, f"must be at least {minimum}, got {value}")

    def between(self, field: str, value: float, low: float, high: float) -> None:
        if not low <= value <= high:
            self.add(field, f"must be between {low} and {high}, got {value}")


class ConfigError(SystemExit):
    """Invalid settings. A SystemExit whose code is the message, so that a
    component that doesn't catch it prints the message instead of a traceback
    and exits with status 1."""

    def __init__(self, component: str, problems: list[str]) -> None:
        self.problems = problems
        super().__init__(f"{component}: invalid configuration:\n  " + "\n  ".join(problems))


class PlatformSettings(BaseSettings):
    """Settings every component understands. Components subclass this and add
    their own fields; all values come from KNOWCEL_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="KNOWCEL_", extra="ignore")

    # Lowest level logged: DEBUG, INFO, WARNING or ERROR.
    log_level: str = "INFO"
    # Log output: json (one object per line) or text.
    log_format: str = "json"
    # Serves the gRPC API; each component defaults it to the port in its
    # module.yaml (0 for workers, which serve none).
    grpc_port: int = 0
    # Serves Prometheus metrics at /metrics (knowcel_platform.metrics); like
    # KNOWCEL_GRPC_PORT, each component defaults it to the port in its module.yaml.
    metrics_port: int = 0
    # NATS server with JetStream (comma-separated for a cluster); used by
    # components that publish or consume events.
    nats_url: str = "nats://localhost:4222"
    # OTLP/gRPC endpoint spans go to, e.g. http://otel-collector:4317; tracing
    # is off while it is empty (knowcel_platform.telemetry).
    otel_endpoint: str = ""

    def check(self, problems: Problems) -> None:
        """Records what is wrong with the settings. Components that add
        settings override it and call super().check(problems) first."""
        if self.log_level.upper() not in logging.getLevelNamesMapping():
            problems.add(
                "log_level", f"must be DEBUG, INFO, WARNING or ERROR, got {self.log_level!r}"
            )
        problems.one_of("log_format", self.log_format, ["json", "text"])
        if self.grpc_port:
            problems.port("grpc_port", self.grpc_port)
        problems.port("metrics_port", self.metrics_port)
        if self.grpc_port and self.grpc_port == self.metrics_port:
            problems.add(
                "metrics_port", f"must differ from KNOWCEL_GRPC_PORT (both {self.grpc_port})"
            )
        for server in self.nats_url.split(","):
            problems.url("nats_url", server.strip(), ["nats", "tls", "ws", "wss"])
        if self.otel_endpoint:
            problems.url("otel_endpoint", self.otel_endpoint, ["http", "https"])


def migrate_legacy_env() -> None:
    """Accepts the former KB_* variables: sets KNOWCEL_x from KB_x where it is
    not set yet, and warns about each KB_* variable. Remove it together with
    the fallback after one release."""
    log = logging.getLogger(__name__)
    for key in sorted(os.environ):
        if not key.startswith("KB_"):
            continue
        name = "KNOWCEL_" + key.removeprefix("KB_")
        if name in os.environ:
            log.warning("ignoring deprecated environment variable %s, %s is set", key, name)
            continue
        log.warning(
            "deprecated environment variable %s, rename it to %s "
            "(support ends after the next release)",
            key,
            name,
        )
        os.environ[name] = os.environ[key]


def env_name(field: str) -> str:
    """The environment variable of a settings field: log_level → KNOWCEL_LOG_LEVEL."""
    return "KNOWCEL_" + field.upper()


def load_settings[S: PlatformSettings](cls: type[S], component: str) -> S:
    """Reads and validates the settings of `component`. Raises ConfigError
    listing every value that does not parse or, if all parse, every problem
    `check` finds."""
    migrate_legacy_env()
    try:
        settings = cls()
    except ValidationError as exc:
        raise ConfigError(component, [_describe(e) for e in exc.errors()]) from None
    problems = Problems()
    settings.check(problems)
    if problems.items:
        raise ConfigError(component, problems.items)
    return settings


def _describe(error: ErrorDetails) -> str:
    loc = error["loc"]
    setting = env_name(str(loc[0])) if loc else "settings"
    return f"{setting}: {error['msg']}, got {error['input']!r}"
