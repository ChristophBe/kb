import pathlib
import shutil

import pytest
from knowcel_ingestion_worker import extract
from knowcel_ingestion_worker.extract import DOCX_TYPE, extract_pages

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def test_docx_yields_paragraphs_and_table_cells_in_order() -> None:
    pages = extract_pages((FIXTURES / "report.docx").read_bytes(), "report.docx", DOCX_TYPE)

    assert [p.number for p in pages] == [None]
    assert pages[0].text == (
        "Quarterly harvest report\n\n"
        "The mycelium network doubled its reach in autumn.\n\n"
        "Crop | Yield\n\nMushrooms | 120 kg\n\n"
        "Compost stays warm through winter."
    )


def test_docx_is_recognised_by_its_extension() -> None:
    data = (FIXTURES / "report.docx").read_bytes()

    pages = extract_pages(data, "report.docx", "application/octet-stream")

    assert "mycelium network" in pages[0].text


@pytest.mark.parametrize(("filename", "content_type"), [("a.html", "text/html"), ("a.htm", "")])
def test_html_yields_the_title_and_article_without_page_furniture(
    filename: str, content_type: str
) -> None:
    pages = extract_pages((FIXTURES / "article.html").read_bytes(), filename, content_type)

    text = pages[0].text
    assert text.startswith("Growing oyster mushrooms")
    assert "colonise straw within two weeks" in text
    assert "Spent substrate makes excellent compost" in text
    assert "Subscribe now" not in text
    assert "Cookie settings" not in text
    assert "<p>" not in text


def test_a_pdf_without_text_layer_is_empty_when_ocr_is_off() -> None:
    pages = extract_pages((FIXTURES / "scan.pdf").read_bytes(), "scan.pdf", "application/pdf")

    assert [(p.number, p.text) for p in pages] == [(1, "")]


def test_ocr_reads_pages_without_text_layer(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_ocr(image: object, lang: str) -> str:
        calls.append(lang)
        return "Scanned invoice number 4711\n"

    monkeypatch.setattr(extract.pytesseract, "image_to_string", fake_ocr)

    pages = extract_pages(
        (FIXTURES / "scan.pdf").read_bytes(), "scan.pdf", "application/pdf", "eng+deu"
    )

    assert [(p.number, p.text) for p in pages] == [(1, "Scanned invoice number 4711\n")]
    assert calls == ["eng+deu"]


def test_ocr_runs_only_on_the_pages_without_text_layer(monkeypatch: pytest.MonkeyPatch) -> None:
    ocr_pages: list[int] = []

    def fake_ocr(image: object, lang: str) -> str:
        ocr_pages.append(len(ocr_pages))
        return "from ocr"

    monkeypatch.setattr(extract.pytesseract, "image_to_string", fake_ocr)
    pdf = (FIXTURES / "pages.pdf").read_bytes()

    plain = extract_pages(pdf, "pages.pdf", "application/pdf")
    pages = extract_pages(pdf, "pages.pdf", "application/pdf", "eng")

    blank = [p.number for p in plain if not p.text.strip()]
    assert blank == [2]
    assert [p.number for p in pages if p.text == "from ocr"] == blank
    assert [p.text for p in pages if p.number != 2] == [p.text for p in plain if p.number != 2]
    assert len(ocr_pages) == 1


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract is not installed")
def test_tesseract_reads_the_scanned_fixture() -> None:
    pages = extract_pages(
        (FIXTURES / "scan.pdf").read_bytes(), "scan.pdf", "application/pdf", "eng"
    )

    assert "4711" in pages[0].text
