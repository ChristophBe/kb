import re

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    """Split text into chunks of at most `size` characters.

    Paragraphs are packed greedily so chunks end on paragraph boundaries where
    possible; paragraphs longer than `size` are cut into windows that overlap
    by `overlap` characters.
    """
    if overlap >= size:
        raise ValueError("overlap must be smaller than size")
    pieces: list[str] = []
    for para in _PARAGRAPH_BREAK.split(text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= size:
            pieces.append(para)
            continue
        step = size - overlap
        pieces.extend(para[i : i + size] for i in range(0, len(para) - overlap, step))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if len(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks
