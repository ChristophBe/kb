import pytest
from knowcel_platform.config import ConfigError, PlatformSettings, Problems, load_settings


class _Settings(PlatformSettings):
    grpc_port: int = 9000
    metrics_port: int = 9100
    peer_addr: str = "localhost:9001"
    size: int = 1

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.addr("peer_addr", self.peer_addr)
        problems.at_least("size", self.size, 1)


def test_settings_read_kb_prefixed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KB_GRPC_PORT", "9100")
    monkeypatch.setenv("KB_NATS_URL", "nats://nats:4222")
    settings = PlatformSettings()
    assert settings.grpc_port == 9100
    assert settings.nats_url == "nats://nats:4222"


def test_defaults_are_valid() -> None:
    assert load_settings(_Settings, "test").peer_addr == "localhost:9001"


def _problems(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> list[str]:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(ConfigError) as exc:
        load_settings(_Settings, "test")
    return exc.value.problems


@pytest.mark.parametrize(
    ("env", "problem"),
    [
        (
            {"KB_LOG_LEVEL": "loud"},
            "KB_LOG_LEVEL: must be DEBUG, INFO, WARNING or ERROR, got 'loud'",
        ),
        ({"KB_LOG_FORMAT": "xml"}, "KB_LOG_FORMAT: must be one of json, text, got 'xml'"),
        (
            {"KB_GRPC_PORT": "70000"},
            "KB_GRPC_PORT: must be a port between 1 and 65535, got 70000",
        ),
        (
            {"KB_METRICS_PORT": "9000"},
            "KB_METRICS_PORT: must differ from KB_GRPC_PORT (both 9000)",
        ),
        (
            {"KB_NATS_URL": "nats://a:4222,http://b"},
            "KB_NATS_URL: must be a URL with a host and scheme nats or tls or ws or wss, "
            "got 'http://b'",
        ),
        (
            {"KB_OTEL_ENDPOINT": "otel:4317"},
            "KB_OTEL_ENDPOINT: must be a URL with a host and scheme http or https, got 'otel:4317'",
        ),
        ({"KB_PEER_ADDR": "peer"}, "KB_PEER_ADDR: must be host:port, got 'peer'"),
        ({"KB_SIZE": "0"}, "KB_SIZE: must be at least 1, got 0"),
    ],
)
def test_each_rule(monkeypatch: pytest.MonkeyPatch, env: dict[str, str], problem: str) -> None:
    assert _problems(monkeypatch, env) == [problem]


def test_all_problems_are_reported_together(monkeypatch: pytest.MonkeyPatch) -> None:
    problems = _problems(
        monkeypatch, {"KB_LOG_LEVEL": "loud", "KB_PEER_ADDR": "peer", "KB_SIZE": "0"}
    )
    assert [p.split(":")[0] for p in problems] == ["KB_LOG_LEVEL", "KB_PEER_ADDR", "KB_SIZE"]


def test_unparsable_values_are_reported_together(monkeypatch: pytest.MonkeyPatch) -> None:
    problems = _problems(monkeypatch, {"KB_GRPC_PORT": "x", "KB_SIZE": "big"})
    assert [p.split(":")[0] for p in problems] == ["KB_GRPC_PORT", "KB_SIZE"]
    assert "got 'x'" in problems[0]


def test_message_lists_every_problem_without_a_traceback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KB_LOG_LEVEL", "loud")
    monkeypatch.setenv("KB_SIZE", "0")
    with pytest.raises(SystemExit) as exc:
        load_settings(_Settings, "test")
    assert (
        exc.value.code
        == str(exc.value)
        == (
            "test: invalid configuration:\n"
            "  KB_LOG_LEVEL: must be DEBUG, INFO, WARNING or ERROR, got 'loud'\n"
            "  KB_SIZE: must be at least 1, got 0"
        )
    )
