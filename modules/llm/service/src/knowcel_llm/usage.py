"""The usage records the llm module keeps; db.py implements the store."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class UsageRecord:
    """One finished generation."""

    # Empty for calls without a user.
    user_id: str
    caller_module: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


@dataclass(frozen=True)
class UsageSum:
    """The generations of one UTC day, model and calling module."""

    date: str
    provider: str
    model: str
    caller_module: str
    requests: int
    input_tokens: int
    output_tokens: int


class UsageStore(Protocol):
    async def record(self, record: UsageRecord) -> None: ...

    async def summarize(self, days: int, user_id: str | None) -> list[UsageSum]:
        """The last `days` days, today included, newest day first then by model
        and calling module; `user_id` limits it to one user (None: everyone)."""
        ...
