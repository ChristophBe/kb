"""Token counting with the embedding model's own tokenizer.

Chunks are measured in tokens because that is what the embedding model's input
limit is measured in. The tokenizer runs offline from a Hugging Face
`tokenizer.json` file; files for the default embedding models are bundled in
`vocab/`, so the worker never downloads anything:

- `nomic-embed-text.json`: `tokenizer.json` of nomic-ai/nomic-embed-text-v1.5
  (revision e9b6763), Apache-2.0. A lower-casing BERT WordPiece tokenizer.
"""

import functools
import pathlib

from tokenizers import Tokenizer as _HfTokenizer

_VOCAB = pathlib.Path(__file__).parent / "vocab"


class TokenizerNotFoundError(ValueError):
    pass


class Tokenizer:
    """Counts the tokens of a text, without the special tokens the model adds."""

    def __init__(self, tokenizer: _HfTokenizer) -> None:
        tokenizer.no_truncation()
        tokenizer.no_padding()
        self._tokenizer = tokenizer

    @property
    def special_tokens(self) -> int:
        """Tokens the model adds to every input (for BERT: [CLS] and [SEP])."""
        return self._tokenizer.num_special_tokens_to_add(is_pair=False)

    def count(self, text: str) -> int:
        return len(self._tokenizer.encode(text, add_special_tokens=False).ids)

    def starts(self, text: str) -> list[int]:
        """Where each token begins, as an index into `text` (in code points)."""
        offsets = self._tokenizer.encode(text, add_special_tokens=False).offsets
        return [start for start, _ in offsets]


def bundled() -> list[str]:
    return sorted(p.stem for p in _VOCAB.glob("*.json"))


@functools.cache
def load(name: str) -> Tokenizer:
    """Loads a bundled tokenizer by name (`nomic-embed-text`, an Ollama tag
    such as `:latest` is ignored), or a `tokenizer.json` file by path."""
    candidate = _VOCAB / f"{name.split(':', 1)[0]}.json"
    if "/" not in name and candidate.is_file():
        return Tokenizer(_HfTokenizer.from_file(str(candidate)))
    file = pathlib.Path(name)
    if file.is_file():
        return Tokenizer(_HfTokenizer.from_file(str(file)))
    raise TokenizerNotFoundError(
        f"no tokenizer {name!r}: use one of {', '.join(bundled())} or a path to a tokenizer.json"
    )
