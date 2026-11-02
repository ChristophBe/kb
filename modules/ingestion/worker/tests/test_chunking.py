import pathlib

import pytest
from kb_ingestion_worker.chunking import Chunk, chunk_markdown, chunk_pages, chunk_text
from kb_ingestion_worker.extract import extract_pages, is_markdown

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def test_short_paragraphs_are_packed_together() -> None:
    text = "alpha\n\nbeta\n\ngamma"
    assert chunk_text(text, size=100, overlap=10) == ["alpha\n\nbeta\n\ngamma"]


def test_chunks_respect_size_and_paragraph_boundaries() -> None:
    paras = ["a" * 40, "b" * 40, "c" * 40]
    chunks = chunk_text("\n\n".join(paras), size=90, overlap=10)
    assert chunks == [f"{paras[0]}\n\n{paras[1]}", paras[2]]


def test_long_paragraph_is_windowed_with_overlap() -> None:
    text = "".join(str(i % 10) for i in range(250))
    chunks = chunk_text(text, size=100, overlap=20)
    assert all(len(c) <= 100 for c in chunks)
    assert chunks[0][-20:] == chunks[1][:20]
    assert chunks[-1].endswith(text[-10:])


def test_empty_text_yields_no_chunks() -> None:
    assert chunk_text("  \n\n ", size=100, overlap=10) == []


def test_overlap_must_be_smaller_than_size() -> None:
    with pytest.raises(ValueError, match="overlap must be smaller"):
        chunk_text("x", size=10, overlap=10)


GUIDE = (FIXTURES / "guide.md").read_text()


def top_level_sections(chunk: Chunk) -> set[str]:
    """The top-level headings whose body text appears in a chunk of the guide."""
    markers = {
        "Installation": "Download the package",
        "Usage": "Upload a document",
        "FAQ": "Short.",
        "Licence": "Also short",
    }
    return {title for title, marker in markers.items() if marker in chunk.text}


def test_markdown_chunks_carry_their_heading_path() -> None:
    chunks = chunk_markdown(GUIDE, size=1000, overlap=100, min_section=50)
    by_heading = {c.heading: c for c in chunks}
    assert set(by_heading) == {
        "",
        "Installation",
        "Installation > Requirements",
        "Installation > Steps",
        "Usage",
        "FAQ",
    }
    assert by_heading["Installation > Requirements"].text.startswith(
        "Installation > Requirements\n\nYou need"
    )
    assert by_heading[""].text.startswith("Preamble")


def test_markdown_chunks_do_not_span_top_level_sections_above_the_minimum() -> None:
    chunks = chunk_markdown(GUIDE, size=1000, overlap=100, min_section=50)
    spanning = [top_level_sections(c) for c in chunks if len(top_level_sections(c)) > 1]
    assert spanning == [{"FAQ", "Licence"}]


def test_short_sections_merge_with_the_next_section_at_the_same_level() -> None:
    chunks = chunk_markdown(GUIDE, size=1000, overlap=100, min_section=50)
    faq = next(c for c in chunks if c.heading == "FAQ")
    assert faq.text == (
        "FAQ\n\nShort.\n\n# Licence\n\nAlso short, and merged with the section before it."
    )


def test_a_minimum_of_zero_merges_nothing() -> None:
    chunks = chunk_markdown(GUIDE, size=1000, overlap=100, min_section=0)
    assert {"FAQ", "Licence"} <= {c.heading for c in chunks}


def test_short_section_does_not_merge_into_a_deeper_or_foreign_section() -> None:
    text = "## one\n\nshort\n\n# empty\n\n## two\n\nshort too"
    chunks = chunk_markdown(text, size=1000, overlap=100, min_section=500)
    assert [c.heading for c in chunks] == ["one", "empty > two"]


def test_merging_stops_when_the_result_would_not_fit() -> None:
    text = f"# a\n\nshort\n\n# b\n\n{'b' * 195}"
    chunks = chunk_markdown(text, size=200, overlap=20, min_section=50)
    assert [c.heading for c in chunks] == ["a", "b"]


def test_headings_inside_code_fences_are_text() -> None:
    chunks = chunk_markdown(GUIDE, size=1000, overlap=100, min_section=50)
    steps = next(c for c in chunks if c.heading == "Installation > Steps")
    assert "# not a heading" in steps.text
    assert not any("not a heading" in c.heading for c in chunks)


def test_long_markdown_sections_stay_within_size_and_keep_the_prefix() -> None:
    text = f"# Title\n\n## Section\n\n{'word ' * 400}"
    chunks = chunk_markdown(text, size=100, overlap=10, min_section=0)
    assert len(chunks) > 1
    assert all(len(c.text) <= 100 for c in chunks)
    assert all(c.text.startswith("Title > Section\n\n") for c in chunks)


def test_a_very_long_heading_cannot_break_the_size_limit() -> None:
    text = f"# {'h' * 500}\n\n{'word ' * 100}"
    chunks = chunk_markdown(text, size=100, overlap=10, min_section=0)
    assert all(len(c.text) <= 100 for c in chunks)


def test_headings_without_text_yield_no_chunks() -> None:
    assert chunk_markdown("# a\n\n## b\n", size=100, overlap=10, min_section=0) == []


def test_pdf_chunks_carry_their_page_and_blank_pages_yield_none() -> None:
    pdf = (FIXTURES / "pages.pdf").read_bytes()
    chunks = chunk_pages(extract_pages(pdf, "pages.pdf", "application/pdf"), 100, 10)
    assert [(c.page, c.text) for c in chunks] == [
        (1, "First page about alpha."),
        (3, "Third page about gamma."),
    ]
    assert chunks[0].metadata == {"page": "1"}


def test_plain_text_has_no_page_or_heading() -> None:
    chunks = chunk_pages(extract_pages(b"# not markdown", "a.txt", "text/plain"), 100, 10)
    assert chunks == [Chunk("# not markdown")]
    assert chunks[0].metadata == {}


@pytest.mark.parametrize(
    ("filename", "content_type", "expected"),
    [
        ("a.md", "application/octet-stream", True),
        ("a.MARKDOWN", "", True),
        ("a", "text/markdown", True),
        ("a.txt", "text/plain", False),
    ],
)
def test_markdown_detection(filename: str, content_type: str, expected: bool) -> None:
    assert is_markdown(filename, content_type) is expected
