import json

import pytest
from kb_platform.logging import setup_logging


def test_setup_logs_the_version(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("KB_VERSION", "1.2.3")
    setup_logging("INFO", "json")
    entry = json.loads(capsys.readouterr().err.splitlines()[-1])
    assert entry["msg"] == "starting version 1.2.3"


def test_version_defaults_to_dev(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("KB_VERSION", raising=False)
    setup_logging("INFO", "text")
    assert "starting version dev" in capsys.readouterr().err
