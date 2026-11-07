import pathlib

import pytest
from kb_ingestion_worker import tokens

VOCAB = pathlib.Path(tokens.__file__).parent / "vocab"


def test_bundled_tokenizers() -> None:
    assert "nomic-embed-text" in tokens.bundled()


def test_an_ollama_tag_selects_the_bundled_tokenizer() -> None:
    assert tokens.load("nomic-embed-text:latest").count("hello world") == 2


def test_a_tokenizer_file_loads_by_path() -> None:
    tokenizer = tokens.load(str(VOCAB / "nomic-embed-text.json"))
    assert tokenizer.count("Hello, World!") == 4


def test_counts_ignore_the_tokenizer_files_truncation() -> None:
    # Tokenizer files may truncate (often at 512); counting must see every token.
    assert tokens.load("nomic-embed-text").count("word " * 3000) == 3000


def test_an_unknown_tokenizer_names_the_bundled_ones() -> None:
    with pytest.raises(tokens.TokenizerNotFoundError, match="nomic-embed-text"):
        tokens.load("no-such-model")
