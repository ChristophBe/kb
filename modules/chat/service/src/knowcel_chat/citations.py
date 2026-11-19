"""Keeping the sources an answer uses: which `[n]` markers it contains."""

import re
from collections.abc import Sequence

# Code the markers in it are not citations of: fenced blocks (to the closing
# fence or the end of the text) and inline spans.
_CODE = re.compile(
    r"^ {0,3}(`{3,}|~{3,})[^\n]*\n.*?(?:^ {0,3}\1[`~]*[ \t]*$|\Z)|(`+)(?!`).+?(?<!`)\2(?!`)",
    re.MULTILINE | re.DOTALL,
)
_MARKER = re.compile(r"\[(\d+)\]")


def used_sources[T](text: str, sources: Sequence[T]) -> tuple[str, list[T]]:
    """The text with its `[n]` markers renumbered in order of first use, and the
    sources they point to, in that order. Sources the text doesn't use are
    dropped; markers without a source and anything in code stay as they are."""
    numbers: dict[int, int] = {}  # old number -> new number

    def renumber(match: re.Match[str]) -> str:
        old = int(match[1])
        if not 1 <= old <= len(sources):
            return match[0]
        return f"[{numbers.setdefault(old, len(numbers) + 1)}]"

    parts: list[str] = []
    last = 0
    for code in _CODE.finditer(text):
        parts.append(_MARKER.sub(renumber, text[last : code.start()]))
        parts.append(code[0])
        last = code.end()
    parts.append(_MARKER.sub(renumber, text[last:]))
    return "".join(parts), [sources[old - 1] for old in numbers]
