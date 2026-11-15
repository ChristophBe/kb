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


def test_settings_read_knowcel_prefixed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KNOWCEL_GRPC_PORT", "9100")
    monkeypatch.setenv("KNOWCEL_NATS_URL", "nats://nats:4222")
    settings = PlatformSettings()
    assert settings.grpc_port == 9100
    assert settings.nats_url == "nats://nats:4222"


def test_deprecated_kb_prefix_is_accepted_with_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # load_settings copies KB_* into os.environ; register the undo first.
    monkeypatch.setenv("KNOWCEL_GRPC_PORT", "")
    monkeypatch.delenv("KNOWCEL_GRPC_PORT")
    monkeypatch.setenv("KB_GRPC_PORT", "9200")
    settings = load_settings(_Settings, "test")
    assert settings.grpc_port == 9200
    assert "KB_GRPC_PORT" in caplog.text


def test_knowcel_prefix_wins_over_deprecated_kb(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("KB_GRPC_PORT", "9100")
    monkeypatch.setenv("KNOWCEL_GRPC_PORT", "9300")
    assert load_settings(_Settings, "test").grpc_port == 9300
    assert "KB_GRPC_PORT" in caplog.text


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
            {"KNOWCEL_LOG_LEVEL": "loud"},
            "KNOWCEL_LOG_LEVEL: must be DEBUG, INFO, WARNING or ERROR, got 'loud'",
        ),
        ({"KNOWCEL_LOG_FORMAT": "xml"}, "KNOWCEL_LOG_FORMAT: must be one of json, text, got 'xml'"),
        (
            {"KNOWCEL_GRPC_PORT": "70000"},
            "KNOWCEL_GRPC_PORT: must be a port between 1 and 65535, got 70000",
        ),
        (
            {"KNOWCEL_METRICS_PORT": "9000"},
            "KNOWCEL_METRICS_PORT: must differ from KNOWCEL_GRPC_PORT (both 9000)",
        ),
        (
            {"KNOWCEL_NATS_URL": "nats://a:4222,http://b"},
            "KNOWCEL_NATS_URL: must be a URL with a host and scheme nats or tls or ws or wss, "
            "got 'http://b'",
        ),
        (
            {"KNOWCEL_OTEL_ENDPOINT": "otel:4317"},
            "KNOWCEL_OTEL_ENDPOINT: must be a URL with a host and scheme http or https, "
            "got 'otel:4317'",
        ),
        ({"KNOWCEL_PEER_ADDR": "peer"}, "KNOWCEL_PEER_ADDR: must be host:port, got 'peer'"),
        ({"KNOWCEL_SIZE": "0"}, "KNOWCEL_SIZE: must be at least 1, got 0"),
    ],
)
def test_each_rule(monkeypatch: pytest.MonkeyPatch, env: dict[str, str], problem: str) -> None:
    assert _problems(monkeypatch, env) == [problem]


def test_all_problems_are_reported_together(monkeypatch: pytest.MonkeyPatch) -> None:
    problems = _problems(
        monkeypatch, {"KNOWCEL_LOG_LEVEL": "loud", "KNOWCEL_PEER_ADDR": "peer", "KNOWCEL_SIZE": "0"}
    )
    assert [p.split(":")[0] for p in problems] == [
        "KNOWCEL_LOG_LEVEL",
        "KNOWCEL_PEER_ADDR",
        "KNOWCEL_SIZE",
    ]


def test_unparsable_values_are_reported_together(monkeypatch: pytest.MonkeyPatch) -> None:
    problems = _problems(monkeypatch, {"KNOWCEL_GRPC_PORT": "x", "KNOWCEL_SIZE": "big"})
    assert [p.split(":")[0] for p in problems] == ["KNOWCEL_GRPC_PORT", "KNOWCEL_SIZE"]
    assert "got 'x'" in problems[0]


def test_message_lists_every_problem_without_a_traceback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KNOWCEL_LOG_LEVEL", "loud")
    monkeypatch.setenv("KNOWCEL_SIZE", "0")
    with pytest.raises(SystemExit) as exc:
        load_settings(_Settings, "test")
    assert (
        exc.value.code
        == str(exc.value)
        == (
            "test: invalid configuration:\n"
            "  KNOWCEL_LOG_LEVEL: must be DEBUG, INFO, WARNING or ERROR, got 'loud'\n"
            "  KNOWCEL_SIZE: must be at least 1, got 0"
        )
    )
