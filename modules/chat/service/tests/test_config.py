from pathlib import Path

import pytest
from kb_chat.config import Settings
from kb_platform.config import Problems


def _problems(**settings: object) -> list[str]:
    found = Problems()
    Settings(**settings).check(found)  # type: ignore[arg-type]
    return found.items


def test_default_settings_are_valid() -> None:
    assert _problems() == []


@pytest.mark.parametrize(
    ("settings", "problem"),
    [
        (
            {"database_url": "postgres://kb:kb@db/kb"},
            "KB_DATABASE_URL: must be a URL with a host and scheme postgresql+asyncpg, "
            "got 'postgres://kb:kb@db/kb'",
        ),
        ({"document_addr": "document"}, "KB_DOCUMENT_ADDR: must be host:port, got 'document'"),
        ({"llm_addr": ":9004"}, "KB_LLM_ADDR: must be host:port, got ':9004'"),
        ({"rag_top_k": 0}, "KB_RAG_TOP_K: must be at least 1, got 0"),
        ({"rag_min_score": 2}, "KB_RAG_MIN_SCORE: must be between -1 and 1, got 2.0"),
        ({"history_limit": -1}, "KB_HISTORY_LIMIT: must be at least 0, got -1"),
        (
            {"answer_reserve_tokens": 0},
            "KB_ANSWER_RESERVE_TOKENS: must be at least 1, got 0",
        ),
        (
            {"context_tokens": 1024},
            "KB_CONTEXT_TOKENS: must be above KB_ANSWER_RESERVE_TOKENS (1024), got 1024",
        ),
        (
            {"manual_dir": Path("/nonexistent")},
            "KB_MANUAL_DIR: must be a directory, got '/nonexistent'",
        ),
        ({"manual_top_k": -1}, "KB_MANUAL_TOP_K: must be at least 0, got -1"),
        ({"manual_min_score": -2}, "KB_MANUAL_MIN_SCORE: must be between -1 and 1, got -2.0"),
    ],
)
def test_each_setting_rule(settings: dict[str, object], problem: str) -> None:
    assert _problems(**settings) == [problem]


def test_problems_are_reported_together() -> None:
    found = _problems(rag_top_k=0, context_tokens=10, manual_top_k=-1)
    assert [p.split(":")[0] for p in found] == [
        "KB_RAG_TOP_K",
        "KB_CONTEXT_TOKENS",
        "KB_MANUAL_TOP_K",
    ]
