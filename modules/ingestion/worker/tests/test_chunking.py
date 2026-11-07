import pathlib
import unicodedata

import pytest
from kb_ingestion_worker.chunking import Chunk, chunk_markdown, chunk_pages, chunk_text
from kb_ingestion_worker.extract import extract_pages, is_markdown
from kb_ingestion_worker.tokens import load

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
TOKENS = load("nomic-embed-text")
ZWJ = "\u200d"


class CodePoints:
    """One token per code point, so cuts can land before combining characters."""

    def count(self, text: str) -> int:
        return len(text)

    def starts(self, text: str) -> list[int]:
        return list(range(len(text)))


class Utf8Bytes:
    """One token per UTF-8 byte, like a byte-level BPE without merges: the tokens
    of a multi-byte character all start at that character."""

    def count(self, text: str) -> int:
        return len(text.encode())

    def starts(self, text: str) -> list[int]:
        return [i for i, char in enumerate(text) for _ in char.encode()]


def test_short_paragraphs_are_packed_together() -> None:
    text = "alpha\n\nbeta\n\ngamma"
    assert chunk_text(text, size=100, overlap=10, tokens=TOKENS) == ["alpha\n\nbeta\n\ngamma"]


def test_chunks_respect_size_and_paragraph_boundaries() -> None:
    paras = [" ".join([word] * 40) for word in ("alpha", "beta", "gamma")]
    chunks = chunk_text("\n\n".join(paras), size=90, overlap=10, tokens=TOKENS)
    assert chunks == [f"{paras[0]}\n\n{paras[1]}", paras[2]]


def test_long_paragraph_is_windowed_with_overlap() -> None:
    words = [f"{n}" for n in range(1000, 1250)]
    text = " ".join(words)
    chunks = chunk_text(text, size=100, overlap=20, tokens=TOKENS)
    assert len(chunks) > 1
    assert all(TOKENS.count(c) <= 100 for c in chunks)
    first, second = chunks[0].split(), chunks[1].split()
    shared = next(n for n in range(len(second), 0, -1) if first[-n:] == second[:n])
    assert TOKENS.count(" ".join(second[:shared])) == 20
    assert chunks[-1].endswith(words[-1])


def test_windows_without_overlap_keep_every_character() -> None:
    text = "".join(f"word{n}," for n in range(300))
    chunks = chunk_text(text, size=50, overlap=0, tokens=TOKENS)
    assert len(chunks) > 1
    assert "".join(chunks) == text


def test_empty_text_yields_no_chunks() -> None:
    assert chunk_text("  \n\n ", size=100, overlap=10, tokens=TOKENS) == []


def test_overlap_must_be_smaller_than_size() -> None:
    with pytest.raises(ValueError, match="overlap must be smaller"):
        chunk_text("x", size=10, overlap=10, tokens=TOKENS)


MULTI_BYTE = {
    # Each CJK character is a token of its own; there are no spaces to cut at.
    "cjk": "知识库把上传的文档切成段落、并为每段计算向量。日本語のテキストも同じです。" * 40,
    "emoji": "Release 👍🏽 done 👩‍👩‍👧‍👦 family 🇩🇪 flag ❤️ " * 60,
    "combining": "café naïve Zoë à là ñ " * 80,
    "mixed": "Größe 大小 размер 크기 🙂 é́ " * 80,
}


def assert_cut_between_characters(text: str, chunks: list[str]) -> None:
    for chunk in chunks:
        assert chunk in text
        assert chunk.encode("utf-8").decode("utf-8") == chunk
        assert unicodedata.category(chunk[0]) not in ("Mn", "Mc", "Me")
        assert chunk[0] not in (ZWJ, "\ufe0f")
        assert not "\U0001f3fb" <= chunk[0] <= "\U0001f3ff"
        assert chunk[-1] != ZWJ
        start = text.index(chunk)
        assert start == 0 or text[start - 1] != ZWJ


@pytest.mark.parametrize("name", sorted(MULTI_BYTE))
@pytest.mark.parametrize("tokens", [TOKENS, CodePoints(), Utf8Bytes()], ids=["bert", "cp", "bytes"])
def test_multi_byte_text_stays_within_size_and_is_cut_between_characters(
    name: str, tokens: object
) -> None:
    text = MULTI_BYTE[name]
    chunks = chunk_text(text, size=64, overlap=8, tokens=tokens)  # type: ignore[arg-type]
    assert len(chunks) > 1
    assert all(tokens.count(c) <= 64 for c in chunks)  # type: ignore[attr-defined]
    assert_cut_between_characters(text, chunks)


@pytest.mark.parametrize("tokens", [TOKENS, CodePoints(), Utf8Bytes()], ids=["bert", "cp", "bytes"])
def test_multi_byte_windows_without_overlap_keep_every_character(tokens: object) -> None:
    text = "".join(MULTI_BYTE.values()).replace(" ", "")
    chunks = chunk_text(text, size=40, overlap=0, tokens=tokens)  # type: ignore[arg-type]
    assert "".join(chunks) == text


def test_multi_byte_markdown_stays_within_size() -> None:
    text = f"# 标题 🙂 Größe\n\n## Abschnitt e\u0301\n\n{MULTI_BYTE['mixed']}"
    chunks = chunk_markdown(text, size=64, overlap=8, min_section=0, tokens=TOKENS)
    assert len(chunks) > 1
    assert all(TOKENS.count(c.text) <= 64 for c in chunks)
    assert all(c.heading == "标题 🙂 Größe > Abschnitt e\u0301" for c in chunks)


def test_bert_counts_cjk_characters_and_emoji_as_tokens() -> None:
    assert TOKENS.count("日本語") == 3
    assert TOKENS.starts("日本語") == [0, 1, 2]
    # Offsets are code points, not bytes: the emoji is one [UNK] token at index 2.
    assert TOKENS.starts("a 👍🏽 b") == [0, 2, 5]
    assert TOKENS.special_tokens == 2


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
    chunks = chunk_markdown(GUIDE, size=250, overlap=25, min_section=12, tokens=TOKENS)
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
    chunks = chunk_markdown(GUIDE, size=250, overlap=25, min_section=12, tokens=TOKENS)
    spanning = [top_level_sections(c) for c in chunks if len(top_level_sections(c)) > 1]
    assert spanning == [{"FAQ", "Licence"}]


def test_short_sections_merge_with_the_next_section_at_the_same_level() -> None:
    chunks = chunk_markdown(GUIDE, size=250, overlap=25, min_section=12, tokens=TOKENS)
    faq = next(c for c in chunks if c.heading == "FAQ")
    assert faq.text == (
        "FAQ\n\nShort.\n\n# Licence\n\nAlso short, and merged with the section before it."
    )


def test_a_minimum_of_zero_merges_nothing() -> None:
    chunks = chunk_markdown(GUIDE, size=250, overlap=25, min_section=0, tokens=TOKENS)
    assert {"FAQ", "Licence"} <= {c.heading for c in chunks}


def test_short_section_does_not_merge_into_a_deeper_or_foreign_section() -> None:
    text = "## one\n\nshort\n\n# empty\n\n## two\n\nshort too"
    chunks = chunk_markdown(text, size=250, overlap=25, min_section=100, tokens=TOKENS)
    assert [c.heading for c in chunks] == ["one", "empty > two"]


def test_merging_stops_when_the_result_would_not_fit() -> None:
    # Merged: a, short, #, b and 197 words, one token each.
    text = f"# a\n\nshort\n\n# b\n\n{'word ' * 197}"
    chunks = chunk_markdown(text, size=200, overlap=20, min_section=50, tokens=TOKENS)
    assert [c.heading for c in chunks] == ["a", "b"]


def test_headings_inside_code_fences_are_text() -> None:
    chunks = chunk_markdown(GUIDE, size=250, overlap=25, min_section=12, tokens=TOKENS)
    steps = next(c for c in chunks if c.heading == "Installation > Steps")
    assert "# not a heading" in steps.text
    assert not any("not a heading" in c.heading for c in chunks)


def test_long_markdown_sections_stay_within_size_and_keep_the_prefix() -> None:
    text = f"# Title\n\n## Section\n\n{'word ' * 400}"
    chunks = chunk_markdown(text, size=100, overlap=10, min_section=0, tokens=TOKENS)
    assert len(chunks) > 1
    assert all(TOKENS.count(c.text) <= 100 for c in chunks)
    assert all(c.text.startswith("Title > Section\n\n") for c in chunks)


def test_a_very_long_heading_cannot_break_the_size_limit() -> None:
    text = f"# {'heading ' * 500}\n\n{'word ' * 100}"
    chunks = chunk_markdown(text, size=100, overlap=10, min_section=0, tokens=TOKENS)
    assert chunks
    assert all(TOKENS.count(c.text) <= 100 for c in chunks)
    assert all(TOKENS.count(c.heading) < 90 for c in chunks)


def test_headings_without_text_yield_no_chunks() -> None:
    assert chunk_markdown("# a\n\n## b\n", size=100, overlap=10, min_section=0, tokens=TOKENS) == []


def test_pdf_chunks_carry_their_page_and_blank_pages_yield_none() -> None:
    pdf = (FIXTURES / "pages.pdf").read_bytes()
    chunks = chunk_pages(extract_pages(pdf, "pages.pdf", "application/pdf"), 100, 10, TOKENS)
    assert [(c.page, c.text) for c in chunks] == [
        (1, "First page about alpha."),
        (3, "Third page about gamma."),
    ]
    assert chunks[0].metadata == {"page": "1"}


def test_plain_text_has_no_page_or_heading() -> None:
    chunks = chunk_pages(extract_pages(b"# not markdown", "a.txt", "text/plain"), 100, 10, TOKENS)
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
