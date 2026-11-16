import io
import pathlib
import re
from dataclasses import dataclass

import lxml.html
import pypdfium2
import pytesseract
from docx import Document as DocxDocument
from docx.table import Table
from pypdf import PdfReader
from readability import Document as ReadableDocument

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".rst"}
HTML_SUFFIXES = {".html", ".htm"}
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
# Pages are rendered at 2x (144 dpi) for OCR, which Tesseract reads well enough.
OCR_RENDER_SCALE = 2
MARKDOWN_SUFFIXES = {".md", ".markdown"}


@dataclass(frozen=True)
class Page:
    """Text of a document, or of one page for paginated formats (1-based)."""

    text: str
    number: int | None = None


class UnsupportedContentError(Exception):
    pass


def extract_pages(
    data: bytes, filename: str, content_type: str, ocr_languages: str | None = None
) -> list[Page]:
    """Return the plain text of a document. New formats are added here.

    ocr_languages (Tesseract codes, "eng+deu") turns on OCR for the PDF pages
    that have no text layer; None leaves them empty.
    """
    suffix = pathlib.PurePath(filename).suffix.lower()
    if content_type == "application/pdf" or suffix == ".pdf":
        return _pdf_pages(data, ocr_languages)
    if content_type == DOCX_TYPE or suffix == ".docx":
        return [Page(_docx_text(data))]
    if content_type == "text/html" or suffix in HTML_SUFFIXES:
        return [Page(_html_text(data))]
    if content_type.startswith("text/") or suffix in TEXT_SUFFIXES:
        return [Page(data.decode("utf-8", errors="replace"))]
    raise UnsupportedContentError(f"unsupported content type {content_type!r} ({filename})")


def _pdf_pages(data: bytes, ocr_languages: str | None) -> list[Page]:
    reader = PdfReader(io.BytesIO(data))
    pages = [(page.extract_text() or "") for page in reader.pages]
    if ocr_languages and any(not text.strip() for text in pages):
        rendered = pypdfium2.PdfDocument(data)
        for index, text in enumerate(pages):
            if not text.strip():
                image = rendered[index].render(scale=OCR_RENDER_SCALE).to_pil()
                pages[index] = pytesseract.image_to_string(image, lang=ocr_languages)
    return [Page(text, number) for number, text in enumerate(pages, start=1)]


def _docx_text(data: bytes) -> str:
    """Paragraphs and table cells in document order, one block per paragraph."""
    document = DocxDocument(io.BytesIO(data))
    blocks: list[str] = []
    for block in document.iter_inner_content():
        if isinstance(block, Table):
            for row in block.rows:
                # A merged cell appears once per column it spans.
                cells = dict.fromkeys(cell.text.strip() for cell in row.cells)
                blocks.append(" | ".join(text for text in cells if text))
        else:
            blocks.append(block.text.strip())
    return "\n\n".join(text for text in blocks if text)


def _html_text(data: bytes) -> str:
    """The main content of a web page: the title, then the article without menus and ads."""
    readable = ReadableDocument(data.decode("utf-8", errors="replace"))
    body = lxml.html.fromstring(readable.summary(html_partial=True))
    for br in body.iter("br"):
        br.tail = "\n" + (br.tail or "")
    for block in body.iter("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre"):
        block.tail = "\n\n" + (block.tail or "")
    text = re.sub(r"\n{3,}", "\n\n", body.text_content()).strip()
    title = readable.short_title().strip()
    return f"{title}\n\n{text}" if title and text else title or text


def is_markdown(filename: str, content_type: str) -> bool:
    suffix = pathlib.PurePath(filename).suffix.lower()
    return content_type == "text/markdown" or suffix in MARKDOWN_SUFFIXES
