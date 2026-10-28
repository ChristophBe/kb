import io
import pathlib

from pypdf import PdfReader

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".html", ".rst"}


class UnsupportedContentError(Exception):
    pass


def extract_text(data: bytes, filename: str, content_type: str) -> str:
    """Return the plain text of a document. New formats are added here."""
    suffix = pathlib.PurePath(filename).suffix.lower()
    if content_type == "application/pdf" or suffix == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if content_type.startswith("text/") or suffix in TEXT_SUFFIXES:
        return data.decode("utf-8", errors="replace")
    raise UnsupportedContentError(f"unsupported content type {content_type!r} ({filename})")
