"""Fits the prompt into the model's context window."""

import logging
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from kb.chat.v1 import chat_pb2

from .repository import MessageRow

log = logging.getLogger("kb_chat")

# Role markers and separators a chat template adds around every message.
MESSAGE_OVERHEAD_TOKENS = 4


class TokenCounter(Protocol):
    def count(self, text: str) -> int: ...


class ApproximateTokenCounter:
    """About four characters per token, which holds for English text with common
    tokenizers. It needs no model files; overestimating a little is the safe side."""

    def count(self, text: str) -> int:
        return math.ceil(len(text) / 4)


# Builds the system message for the given sources.
SystemPrompt = Callable[[Sequence[chat_pb2.Citation]], str]


@dataclass(frozen=True)
class Context:
    """The sources and history that fit, best source first, oldest message first."""

    sources: list[chat_pb2.Citation]
    history: list[MessageRow]


def fit(
    budget: int,
    counter: TokenCounter,
    system_prompt: SystemPrompt,
    sources: Sequence[chat_pb2.Citation],
    history: Sequence[MessageRow],
    question: str,
) -> Context:
    """Drops the oldest history first, then the lowest-scoring sources, until the
    prompt fits in `budget` tokens. The question and the best source always stay,
    even when they alone exceed the budget."""
    kept_sources = sorted(sources, key=lambda c: c.score, reverse=True)
    kept_history = list(history)

    def size() -> int:
        messages = [system_prompt(kept_sources), *(m.content for m in kept_history), question]
        return sum(counter.count(text) + MESSAGE_OVERHEAD_TOKENS for text in messages)

    while size() > budget:
        if kept_history:
            kept_history.pop(0)
        elif len(kept_sources) > 1:
            kept_sources.pop()
        else:
            log.warning("prompt exceeds the context budget of %d tokens", budget)
            break
    return Context(kept_sources, kept_history)
