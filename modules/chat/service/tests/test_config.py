from pathlib import Path

import pytest
from knowcel_chat.config import Settings
from knowcel_platform.config import Problems


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
            "KNOWCEL_DATABASE_URL: must be a URL with a host and scheme postgresql+asyncpg, "
            "got 'postgres://kb:kb@db/kb'",
        ),
        ({"document_addr": "document"}, "KNOWCEL_DOCUMENT_ADDR: must be host:port, got 'document'"),
        ({"llm_addr": ":9004"}, "KNOWCEL_LLM_ADDR: must be host:port, got ':9004'"),
        ({"curation_addr": "curation"}, "KNOWCEL_CURATION_ADDR: must be host:port, got 'curation'"),
        ({"curation_timeout": 0}, "KNOWCEL_CURATION_TIMEOUT: must be positive, got 0.0"),
        ({"curation_weight": 1.5}, "KNOWCEL_CURATION_WEIGHT: must be between 0 and 1, got 1.5"),
        ({"rag_top_k": 0}, "KNOWCEL_RAG_TOP_K: must be at least 1, got 0"),
        (
            {"rag_top_k": 5, "rerank_candidates": 3},
            "KNOWCEL_RERANK_CANDIDATES: must be at least 5, got 3",
        ),
        ({"rag_min_score": 2}, "KNOWCEL_RAG_MIN_SCORE: must be between -1 and 1, got 2.0"),
        ({"history_limit": -1}, "KNOWCEL_HISTORY_LIMIT: must be at least 0, got -1"),
        (
            {"answer_reserve_tokens": 0},
            "KNOWCEL_ANSWER_RESERVE_TOKENS: must be at least 1, got 0",
        ),
        (
            {"context_tokens": 1024},
            "KNOWCEL_CONTEXT_TOKENS: must be above KNOWCEL_ANSWER_RESERVE_TOKENS (1024), got 1024",
        ),
        (
            {"manual_dir": Path("/nonexistent")},
            "KNOWCEL_MANUAL_DIR: must be a directory, got '/nonexistent'",
        ),
        ({"manual_top_k": -1}, "KNOWCEL_MANUAL_TOP_K: must be at least 0, got -1"),
        ({"manual_min_score": -2}, "KNOWCEL_MANUAL_MIN_SCORE: must be between -1 and 1, got -2.0"),
    ],
)
def test_each_setting_rule(settings: dict[str, object], problem: str) -> None:
    assert _problems(**settings) == [problem]


def test_problems_are_reported_together() -> None:
    found = _problems(rag_top_k=0, context_tokens=10, manual_top_k=-1)
    assert [p.split(":")[0] for p in found] == [
        "KNOWCEL_RAG_TOP_K",
        "KNOWCEL_CONTEXT_TOKENS",
        "KNOWCEL_MANUAL_TOP_K",
    ]
