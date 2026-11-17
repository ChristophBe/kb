"""Reranking with a chat model. No supported vendor offers a rerank endpoint
that works across all of them, so a chat model rates all candidates in one
prompt (listwise), which costs one generation instead of one per candidate."""

import re

from .base import GenerationOptions, Message, Provider, ProviderError, Role

# Characters of a candidate shown to the model; the rest rarely changes a rating.
MAX_DOCUMENT_CHARS = 1500
MAX_RATING = 10

_SYSTEM = (
    "You rate how well passages answer a question. Rate every passage from 0 "
    f"(unrelated) to {MAX_RATING} (answers the question). Reply with one line per "
    "passage in the form `<passage number>: <rating>` and nothing else."
)
# "[2]: 8", "2: 8" or "2 = 8"; a line may also be wrapped in markup.
_RATING = re.compile(r"\[?(\d+)\]?\s*[:=]\s*(\d+(?:\.\d+)?)")


async def rerank_with_chat(
    provider: Provider, model: str, query: str, documents: list[str]
) -> list[float]:
    """Scores each document from 0 to 1 by asking the chat model of `provider`.
    Raises ProviderError when the model's reply isn't a rating per document."""
    passages = "\n\n".join(
        f"[{i}] {text[:MAX_DOCUMENT_CHARS]}" for i, text in enumerate(documents, start=1)
    )
    messages = [
        Message(Role.SYSTEM, _SYSTEM),
        Message(Role.USER, f"Question: {query}\n\nPassages:\n{passages}"),
    ]
    reply = "".join(
        [
            c.delta
            async for c in provider.generate(model, messages, GenerationOptions(temperature=0))
        ]
    )
    return parse_ratings(reply, len(documents))


def parse_ratings(reply: str, count: int) -> list[float]:
    """Reads `<number>: <rating>` lines. Small models sometimes rate only the
    passages they find relevant, so passages without a rating count as unrelated;
    a reply without a single rating is an error."""
    ratings = [0.0] * count
    found = False
    for number, rating in _RATING.findall(reply):
        index = int(number) - 1
        if 0 <= index < count:
            ratings[index] = min(float(rating), MAX_RATING) / MAX_RATING
            found = True
    if not found:
        raise ProviderError(f"rerank: the model did not rate any of {count} passages")
    return ratings
