from collections.abc import AsyncGenerator
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class ProviderError(Exception):
    """A provider call failed. The message is logged, never sent to callers."""


class ProviderUnavailableError(ProviderError):
    """The provider cannot be reached, is overloaded or timed out; try again later."""


class ProviderRateLimitedError(ProviderUnavailableError):
    """The provider rejected the call because a rate limit or quota is used up."""


class ModelNotFoundError(ProviderError):
    """The provider does not know the requested model."""


class ProviderAuthError(ProviderError):
    """The provider rejected kb's credentials (a missing, wrong or revoked key)."""


class NotSupportedError(ProviderError):
    """The provider does not offer this operation (e.g. embeddings)."""


class Role(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class ModelKind(StrEnum):
    CHAT = "chat"
    EMBEDDING = "embedding"


@dataclass(frozen=True)
class Message:
    role: Role
    content: str


@dataclass(frozen=True)
class GenerationOptions:
    temperature: float | None = None
    max_tokens: int | None = None


@dataclass(frozen=True)
class Chunk:
    """One streamed piece of a generation. The final chunk has done=True and
    carries token usage when the provider reports it."""

    delta: str = ""
    done: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class ModelInfo:
    id: str
    kind: ModelKind


@dataclass(frozen=True)
class Status:
    healthy: bool
    detail: str = ""


class Provider(Protocol):
    """Adapter for one LLM vendor. Implementations live next to this file and
    are registered in kb_llm.providers.REGISTRY. Failures are raised as
    ProviderError, so the server needs no knowledge of a vendor's client."""

    name: str
    default_chat_model: str
    default_embedding_model: str

    def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]: ...

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]: ...

    async def list_models(self) -> list[ModelInfo]: ...

    async def status(self) -> Status: ...

    async def aclose(self) -> None: ...
