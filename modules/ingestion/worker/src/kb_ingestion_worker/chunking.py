import re
import unicodedata
from dataclasses import dataclass
from typing import Protocol

from .extract import Page

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")
_PATH_SEPARATOR = " > "
_ZWJ = "\u200d"


@dataclass(frozen=True)
class Chunk:
    """A piece of a document and where it came from."""

    text: str
    heading: str = ""
    page: int | None = None

    @property
    def metadata(self) -> dict[str, str]:
        metadata: dict[str, str] = {}
        if self.heading:
            metadata["heading"] = self.heading
        if self.page is not None:
            metadata["page"] = str(self.page)
        return metadata


@dataclass
class _Section:
    """The text below one Markdown heading, up to the next heading."""

    path: list[str]
    level: int
    lines: list[str]

    @property
    def body(self) -> str:
        return "\n".join(self.lines).strip()


class Tokens(Protocol):
    """Measures text in the embedding model's tokens (see tokens.Tokenizer)."""

    def count(self, text: str) -> int: ...

    def starts(self, text: str) -> list[int]: ...


def chunk_text(text: str, size: int, overlap: int, tokens: Tokens) -> list[str]:
    """Split text into chunks of at most `size` tokens.

    Paragraphs are packed greedily so chunks end on paragraph boundaries where
    possible; paragraphs longer than `size` are cut into windows that overlap
    by `overlap` tokens. Cuts fall between tokens, never inside a code point
    or before a combining character.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    pieces: list[str] = []
    for para in _PARAGRAPH_BREAK.split(text):
        para = para.strip()
        if not para:
            continue
        if tokens.count(para) <= size:
            pieces.append(para)
        else:
            pieces.extend(_windows(para, size, overlap, tokens))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if tokens.count(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


def _windows(text: str, size: int, overlap: int, tokens: Tokens) -> list[str]:
    """Cuts text into windows of at most `size` tokens, each starting `overlap`
    tokens before the previous one ended. A window runs up to where the next
    token starts, so no text between tokens is lost."""
    cuts = _cuts(text, tokens)
    windows: list[str] = []
    first = 0
    while True:
        last = min(first + size, len(cuts))
        while True:
            end = cuts[last] if last < len(cuts) else len(text)
            window = text[cuts[first] : end].strip()
            # Tokenizing a window on its own can differ from the whole text at its edges.
            if tokens.count(window) <= size or last == first + 1:
                break
            last -= 1
        if window:
            windows.append(window)
        if last >= len(cuts):
            return windows
        first = max(last - overlap, first + 1)


def _cuts(text: str, tokens: Tokens) -> list[int]:
    """Indices where text may be cut: token starts, moved past characters that
    belong to the one before them. The first cut is the start of the text."""
    cuts = [0]
    for start in tokens.starts(text):
        while start < len(text) and _continues(text, start):
            start += 1
        if cuts[-1] < start < len(text):
            cuts.append(start)
    return cuts


def _continues(text: str, i: int) -> bool:
    """Whether text[i] belongs to the character before it: a combining mark,
    a variation selector or emoji modifier, or anything after a zero-width joiner."""
    char = text[i]
    return (
        unicodedata.category(char) in ("Mn", "Mc", "Me")
        or "\ufe00" <= char <= "\ufe0f"
        or "\U0001f3fb" <= char <= "\U0001f3ff"
        or char == _ZWJ
        or (i > 0 and text[i - 1] == _ZWJ)
    )


def _truncate(text: str, limit: int, tokens: Tokens) -> str:
    """The longest start of text of at most `limit` tokens, cut between tokens."""
    if tokens.count(text) <= limit:
        return text
    cuts = _cuts(text, tokens)
    for last in range(min(limit, len(cuts) - 1), 0, -1):
        head = text[: cuts[last]].rstrip()
        if tokens.count(head) <= limit:
            return head
    return ""


def chunk_pages(pages: list[Page], size: int, overlap: int, tokens: Tokens) -> list[Chunk]:
    """Chunk each page on its own, so that every chunk has exactly one page."""
    return [
        Chunk(text, page=page.number)
        for page in pages
        for text in chunk_text(page.text, size, overlap, tokens)
    ]


def chunk_markdown(
    text: str, size: int, overlap: int, min_section: int, tokens: Tokens
) -> list[Chunk]:
    """Split Markdown along its headings; each chunk starts with its heading path.

    A section shorter than `min_section` tokens merges with the next section
    at the same level below the same parent, as long as the result fits in
    `size`. Otherwise sections never share a chunk. Only ATX (`#`) headings count.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    chunks: list[Chunk] = []
    for section in _merge_short(_sections(text), size, min_section, tokens):
        # The heading must leave room for a window of more than `overlap`.
        heading = _truncate(_PATH_SEPARATOR.join(section.path), size - overlap - 1, tokens)
        prefix = f"{heading}\n\n" if heading else ""
        budget = max(size - tokens.count(prefix), 1)
        while True:
            bodies = chunk_text(section.body, budget, min(overlap, budget - 1), tokens)
            excess = max((tokens.count(f"{prefix}{b}") - size for b in bodies), default=0)
            if excess <= 0 or budget <= 1:
                break
            budget = max(budget - excess, 1)
        chunks.extend(Chunk(f"{prefix}{body}", heading=heading) for body in bodies)
    return chunks


def _sections(text: str) -> list[_Section]:
    sections = [_Section(path=[], level=0, lines=[])]
    stack: list[tuple[int, str]] = []
    fence = ""
    for line in text.splitlines():
        marker = _FENCE.match(line)
        if marker and (not fence or marker.group(1) == fence):
            fence = "" if fence else marker.group(1)
        heading = None if fence else _HEADING.match(line)
        if not heading:
            sections[-1].lines.append(line)
            continue
        level = len(heading.group(1))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, heading.group(2)))
        sections.append(_Section(path=[title for _, title in stack], level=level, lines=[]))
    return sections


def _merge_short(
    sections: list[_Section], size: int, min_section: int, tokens: Tokens
) -> list[_Section]:
    """Comparing parents here, before empty sections are dropped, keeps an empty
    top-level heading between two sections from going unnoticed."""
    merged: list[_Section] = []
    for section in sections:
        previous = merged[-1] if merged else None
        if (
            previous is not None
            and previous.body
            and section.body
            and tokens.count(previous.body) < min_section
            and section.level == previous.level
            and section.path[:-1] == previous.path[:-1]
        ):
            line = f"{'#' * section.level} {section.path[-1]}"
            lines = [*previous.lines, "", line, "", *section.lines]
            candidate = _Section(previous.path, previous.level, lines)
            heading = _PATH_SEPARATOR.join(previous.path)
            if tokens.count(f"{heading}\n\n{candidate.body}") <= size:
                merged[-1] = candidate
                continue
        merged.append(section)
    return merged
