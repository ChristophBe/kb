import pytest
from kb_ingestion_worker.chunking import chunk_text


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
    with pytest.raises(ValueError):
        chunk_text("x", size=10, overlap=10)
