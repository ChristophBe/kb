"""The user manual as a source for answers: its sections are embedded once and
searched in memory. The manual is never stored as documents, so it can't mix
into the user's knowledge base or drift from the deployed version."""

import asyncio
import logging
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from kb.chat.v1 import chat_pb2

from .chat import PeerError

log = logging.getLogger("kb_chat")

# The README holds the rules for writing the manual, not help for users.
_SKIPPED_PAGES = {"README"}
_FENCE = re.compile(r"^\s*(```|~~~)")
# Like the help page: drop all but letters, digits, whitespace, "_" and "-",
# then turn every whitespace character into "-" (runs are not collapsed).
_SLUG_DROPPED = re.compile(r"[^\w\s-]")
_WHITESPACE = re.compile(r"\s")


@dataclass(frozen=True)
class Section:
    """A `##` section of a manual page, the unit that is embedded and cited."""

    page: str
    page_title: str
    anchor: str
    heading: str
    text: str

    @property
    def title(self) -> str:
        return f"{self.page_title}: {self.heading}"


def slug(heading: str) -> str:
    """The anchor the help page (like GitHub) gives a heading."""
    return _WHITESPACE.sub("-", _SLUG_DROPPED.sub("", heading.strip().lower()))


def parse_page(page: str, markdown: str) -> list[Section]:
    """Splits a page into its `##` sections; deeper headings stay in their
    section, and the introduction under the `#` heading is left out."""
    page_title = page
    sections: list[Section] = []
    heading: str | None = None
    body: list[str] = []
    in_code = False

    def close() -> None:
        text = "\n".join(body).strip()
        if heading is not None and text:
            sections.append(Section(page, page_title, slug(heading), heading, text))

    for line in markdown.splitlines():
        if _FENCE.match(line):
            in_code = not in_code
        elif not in_code and line.startswith("# "):
            page_title = line[2:].strip()
            continue
        elif not in_code and line.startswith("## "):
            close()
            heading, body = line[3:].strip(), []
            continue
        body.append(line)
    close()
    return sections


def load_sections(directory: Path) -> list[Section]:
    """All sections of the manual pages in `directory`, page by page."""
    return [
        section
        for path in sorted(directory.glob("*.md"))
        if path.stem not in _SKIPPED_PAGES
        for section in parse_page(path.stem, path.read_text(encoding="utf-8"))
    ]


class Embedder(Protocol):
    """Embeds texts. Failures are raised as PeerError."""

    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class Manual:
    """The embedded manual. It is empty until `load` has succeeded, so chat
    answers without it while the llm module is down."""

    def __init__(self, sections: Sequence[Section], limit: int, min_score: float) -> None:
        self._sections = list(sections)
        self._limit = limit
        self._min_score = min_score
        self._vectors: list[list[float]] = []

    @property
    def loaded(self) -> bool:
        return bool(self._vectors)

    async def load(self, embedder: Embedder, retry_delay: float = 5, max_delay: float = 60) -> None:
        """Embeds every section, retrying with backoff until the llm module answers."""
        if not self._sections:
            log.warning("the user manual has no sections; chat answers without it")
            return
        texts = [f"{s.title}\n\n{s.text}" for s in self._sections]
        delay = retry_delay
        while True:
            try:
                vectors = await embedder.embed(texts)
            except PeerError as err:
                log.warning("embedding the user manual failed, retrying in %ss: %s", delay, err)
                await asyncio.sleep(delay)
                delay = min(delay * 2, max_delay)
                continue
            self._vectors = [_normalized(v) for v in vectors]
            log.info("embedded %d sections of the user manual", len(self._vectors))
            return

    def search(self, embedding: Sequence[float]) -> list[chat_pb2.Citation]:
        """The best sections for a query embedding, at most `limit` and only
        those scoring at least `min_score` (cosine similarity, like document search)."""
        if not self._vectors:
            return []
        query = _normalized(embedding)
        scored = sorted(
            ((_dot(query, v), s) for v, s in zip(self._vectors, self._sections, strict=True)),
            key=lambda pair: pair[0],
            reverse=True,
        )
        return [
            chat_pb2.Citation(
                document_title=s.title,
                snippet=s.text,
                score=score,
                manual_page=s.page,
                manual_section=s.anchor,
            )
            for score, s in scored[: self._limit]
            if score >= self._min_score
        ]


def merge_sources(
    documents: Sequence[chat_pb2.Citation], manual: Sequence[chat_pb2.Citation]
) -> list[chat_pb2.Citation]:
    """Adds manual sections to the document passages, best first. Every document
    passage is kept: the manual only adds its few best sections on top, so it
    never takes their place."""
    return sorted([*documents, *manual], key=lambda c: c.score, reverse=True)


def _normalized(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))
