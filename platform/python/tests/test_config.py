import pytest
from kb_platform.config import PlatformSettings


def test_settings_read_kb_prefixed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KB_GRPC_PORT", "9100")
    monkeypatch.setenv("KB_NATS_URL", "nats://nats:4222")
    settings = PlatformSettings()
    assert settings.grpc_port == 9100
    assert settings.nats_url == "nats://nats:4222"
