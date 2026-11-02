import re
from dataclasses import dataclass

from .extract import Page

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")
_PATH_SEPARATOR = " > "


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


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    """Split text into chunks of at most `size` characters.

    Paragraphs are packed greedily so chunks end on paragraph boundaries where
    possible; paragraphs longer than `size` are cut into windows that overlap
    by `overlap` characters.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    pieces: list[str] = []
    for para in _PARAGRAPH_BREAK.split(text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= size:
            pieces.append(para)
            continue
        step = size - overlap
        pieces.extend(para[i : i + size] for i in range(0, len(para) - overlap, step))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if len(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


def chunk_pages(pages: list[Page], size: int, overlap: int) -> list[Chunk]:
    """Chunk each page on its own, so that every chunk has exactly one page."""
    return [
        Chunk(text, page=page.number)
        for page in pages
        for text in chunk_text(page.text, size, overlap)
    ]


def chunk_markdown(text: str, size: int, overlap: int, min_section: int) -> list[Chunk]:
    """Split Markdown along its headings; each chunk starts with its heading path.

    A section shorter than `min_section` characters merges with the next section
    at the same level below the same parent, as long as the result fits in
    `size`. Otherwise sections never share a chunk. Only ATX (`#`) headings count.
    """
    chunks: list[Chunk] = []
    for section in _merge_short(_sections(text), size, min_section):
        heading = _PATH_SEPARATOR.join(section.path)
        # The heading must leave room for a window of more than `overlap`.
        heading = heading[: max(size - overlap - 3, 0)]
        prefix = f"{heading}\n\n" if heading else ""
        bodies = chunk_text(section.body, size - len(prefix), overlap)
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


def _merge_short(sections: list[_Section], size: int, min_section: int) -> list[_Section]:
    """Comparing parents here, before empty sections are dropped, keeps an empty
    top-level heading between two sections from going unnoticed."""
    merged: list[_Section] = []
    for section in sections:
        previous = merged[-1] if merged else None
        if (
            previous is not None
            and previous.body
            and section.body
            and len(previous.body) < min_section
            and section.level == previous.level
            and section.path[:-1] == previous.path[:-1]
        ):
            line = f"{'#' * section.level} {section.path[-1]}"
            lines = [*previous.lines, "", line, "", *section.lines]
            candidate = _Section(previous.path, previous.level, lines)
            if len(candidate.body) + len(_PATH_SEPARATOR.join(previous.path)) + 2 <= size:
                merged[-1] = candidate
                continue
        merged.append(section)
    return merged
