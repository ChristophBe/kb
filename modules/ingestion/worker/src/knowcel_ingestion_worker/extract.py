import io
import pathlib
from dataclasses import dataclass

from pypdf import PdfReader

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".html", ".rst"}
MARKDOWN_SUFFIXES = {".md", ".markdown"}


@dataclass(frozen=True)
class Page:
    """Text of a document, or of one page for paginated formats (1-based)."""

    text: str
    number: int | None = None


class UnsupportedContentError(Exception):
    pass


def extract_pages(data: bytes, filename: str, content_type: str) -> list[Page]:
    """Return the plain text of a document. New formats are added here."""
    suffix = pathlib.PurePath(filename).suffix.lower()
    if content_type == "application/pdf" or suffix == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return [
            Page(page.extract_text() or "", number)
            for number, page in enumerate(reader.pages, start=1)
        ]
    if content_type.startswith("text/") or suffix in TEXT_SUFFIXES:
        return [Page(data.decode("utf-8", errors="replace"))]
    raise UnsupportedContentError(f"unsupported content type {content_type!r} ({filename})")


def is_markdown(filename: str, content_type: str) -> bool:
    suffix = pathlib.PurePath(filename).suffix.lower()
    return content_type == "text/markdown" or suffix in MARKDOWN_SUFFIXES
