from collections.abc import Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from kb.chat.v1 import chat_pb2
from kb_chat.chat import Peer, PeerUnavailableError
from kb_chat.config import Settings
from kb_chat.manual import Manual, Section, load_sections, merge_sources, parse_page, slug
from kb_chat.peers import PeerRetriever

PAGE = """# Chat

Ask questions about your documents.

## Restrict a chat to some documents

1. Select **Documents**.

### Change the selection

Select **Documents** again.

## Empty section

## Stop an answer (while it's written)

```markdown
## Not a heading
```
"""


def test_slug_matches_github_anchors() -> None:
    assert slug("Restrict a chat to some documents") == "restrict-a-chat-to-some-documents"
    assert slug("Stop an answer (while it's written)") == "stop-an-answer-while-its-written"
    assert slug("Switch between light and dark mode") == "switch-between-light-and-dark-mode"
    assert slug("Fix a failed upload \u2013 step-by-step") == "fix-a-failed-upload--step-by-step"


def test_a_page_is_split_into_its_level_two_sections() -> None:
    sections = parse_page("chat", PAGE)

    assert [s.heading for s in sections] == [
        "Restrict a chat to some documents",
        "Stop an answer (while it's written)",
    ]
    restrict, stop = sections
    assert restrict.page == "chat"
    assert restrict.page_title == "Chat"
    assert restrict.anchor == "restrict-a-chat-to-some-documents"
    assert restrict.title == "Chat: Restrict a chat to some documents"
    # Deeper headings stay in their section; the introduction is left out.
    assert "### Change the selection" in restrict.text
    assert "Ask questions" not in restrict.text
    # A heading inside a code block doesn't start a section.
    assert "## Not a heading" in stop.text


def test_the_readme_is_not_part_of_the_manual(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# User manual\n\n## Rules\n\nWrite well.\n")
    (tmp_path / "chat.md").write_text(PAGE)

    assert {s.page for s in load_sections(tmp_path)} == {"chat"}


def test_a_missing_manual_has_no_sections(tmp_path: Path) -> None:
    assert load_sections(tmp_path / "missing") == []


def test_the_shipped_manual_has_unique_anchors_per_page() -> None:
    sections = load_sections(Settings().manual_dir)

    assert {s.page for s in sections} >= {"chat", "documents", "search"}
    anchors = [(s.page, s.anchor) for s in sections]
    assert len(anchors) == len(set(anchors))


def section(page: str, heading: str) -> Section:
    return Section(page, page.title(), slug(heading), heading, f"How to {heading.lower()}.")


SECTIONS = [section("chat", "Stop an answer"), section("search", "Search your documents")]
VECTORS = {SECTIONS[0].text: [1.0, 0.0], SECTIONS[1].text: [0.0, 1.0]}


class FakeEmbedder:
    def __init__(self, failures: int = 0) -> None:
        self.failures = failures
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls += 1
        if self.calls <= self.failures:
            raise PeerUnavailableError(Peer.LLM, "down")
        return [next(v for text, v in VECTORS.items() if text in t) for t in texts]


async def loaded_manual(limit: int = 2, min_score: float = 0.5) -> Manual:
    manual = Manual(SECTIONS, limit, min_score)
    await manual.load(FakeEmbedder())
    return manual


async def test_search_cites_the_best_sections_above_the_threshold() -> None:
    manual = await loaded_manual()

    (hit,) = manual.search([0.9, 0.1])

    assert hit.manual_page == "chat"
    assert hit.manual_section == "stop-an-answer"
    assert hit.document_title == "Chat: Stop an answer"
    assert hit.snippet == "How to stop an answer."
    assert hit.document_id == ""
    assert hit.score == pytest.approx(0.9 / (0.81 + 0.01) ** 0.5)


async def test_search_returns_at_most_the_limit() -> None:
    manual = await loaded_manual(limit=1, min_score=0)

    assert [h.manual_page for h in manual.search([0.6, 0.8])] == ["search"]


async def test_nothing_is_found_before_the_manual_is_loaded() -> None:
    manual = Manual(SECTIONS, 2, 0)

    assert not manual.loaded
    assert manual.search([1.0, 0.0]) == []


async def test_loading_retries_until_the_llm_answers() -> None:
    manual = Manual(SECTIONS, 2, 0.5)
    embedder = FakeEmbedder(failures=2)

    await manual.load(embedder, retry_delay=0)

    assert embedder.calls == 3
    assert manual.loaded


async def test_an_empty_manual_does_not_call_the_llm() -> None:
    manual = Manual([], 2, 0.5)
    embedder = FakeEmbedder()

    await manual.load(embedder)

    assert embedder.calls == 0
    assert manual.search([1.0, 0.0]) == []


def doc(title: str, score: float) -> chat_pb2.Citation:
    return chat_pb2.Citation(document_id=title, document_title=title, score=score)


def manual_hit(section: str, score: float) -> chat_pb2.Citation:
    return chat_pb2.Citation(manual_page="chat", manual_section=section, score=score)


def test_manual_sections_never_take_the_place_of_document_passages() -> None:
    documents = [doc(f"d{i}", 0.5 - i / 100) for i in range(5)]
    manual = [manual_hit("a", 0.9), manual_hit("b", 0.8)]

    merged = merge_sources(documents, manual)

    assert [c.document_id or c.manual_section for c in merged] == [
        "a",
        "b",
        "d0",
        "d1",
        "d2",
        "d3",
        "d4",
    ]


def test_merged_sources_are_ranked_by_score() -> None:
    merged = merge_sources([doc("d0", 0.8), doc("d1", 0.6)], [manual_hit("a", 0.7)])

    assert [c.document_id or c.manual_section for c in merged] == ["d0", "a", "d1"]


class FakeLlm:
    def __init__(self) -> None:
        self.inputs: list[list[str]] = []

    async def Embed(self, request: Any) -> Any:
        self.inputs.append(list(request.inputs))
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 0.0])])


class FakeDocuments:
    async def SearchChunks(self, request: Any) -> Any:
        chunk = SimpleNamespace(document_id="d1", index=3, text="passage")
        return SimpleNamespace(
            results=[SimpleNamespace(chunk=chunk, document_title="Report", score=0.4)]
        )


async def test_the_retriever_embeds_the_question_once_for_documents_and_manual() -> None:
    llm = FakeLlm()
    manual = await loaded_manual()
    retriever = PeerRetriever(FakeDocuments(), llm, manual)  # type: ignore[arg-type]

    sources = await retriever.retrieve("How do I stop an answer?", 5, [])

    assert llm.inputs == [["How do I stop an answer?"]]
    assert [(s.manual_section, s.document_id) for s in sources] == [
        ("stop-an-answer", ""),
        ("", "d1"),
    ]


async def test_the_retriever_works_without_a_manual() -> None:
    retriever = PeerRetriever(FakeDocuments(), FakeLlm())  # type: ignore[arg-type]

    sources = await retriever.retrieve("q", 5, [])

    assert [s.document_id for s in sources] == ["d1"]
