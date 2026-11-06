"""Plain-text previews of messages for the conversation list."""

import re

PREVIEW_LENGTH = 120

_FENCE = re.compile(r"^\s*(```|~~~).*$", re.MULTILINE)
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_CITATION = re.compile(r"\s*\[\d+\]")
_HTML = re.compile(r"<[^>]+>")
_LINE_PREFIX = re.compile(r"^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)", re.MULTILINE)
_RULE = re.compile(r"^\s*([-*_]\s*){3,}$", re.MULTILINE)
_EMPHASIS = re.compile(r"(\*\*|__|~~|\*|`)")
_UNDERSCORE = re.compile(r"(?<!\w)_([^_]+)_(?!\w)")
_TABLE_DELIMITER = re.compile(r"^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$", re.MULTILINE)
_TABLE_PIPE = re.compile(r"\s*\|\s*")
_SPACE = re.compile(r"\s+")


def plain_text(markdown: str) -> str:
    """Removes Markdown syntax and citation markers like [1], keeping the words."""
    text = _FENCE.sub("", markdown)
    text = _IMAGE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _CITATION.sub("", text)
    text = _HTML.sub("", text)
    text = _TABLE_DELIMITER.sub("", text)
    text = _RULE.sub("", text)
    text = _LINE_PREFIX.sub("", text)
    text = _EMPHASIS.sub("", text)
    text = _UNDERSCORE.sub(r"\1", text)
    text = _TABLE_PIPE.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


def preview(markdown: str, length: int = PREVIEW_LENGTH) -> str:
    """The start of a message as one line of plain text, at most `length`
    characters; a cut ends in an ellipsis."""
    text = plain_text(markdown)
    if len(text) <= length:
        return text
    cut = text[: length - 1]
    # End on a word boundary unless that throws away most of the preview.
    space = cut.rfind(" ")
    if space > length // 2:
        cut = cut[:space]
    return cut.rstrip() + "…"
