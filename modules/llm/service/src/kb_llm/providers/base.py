from collections.abc import AsyncIterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


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
    are registered in kb_llm.providers.REGISTRY."""

    name: str
    default_chat_model: str
    default_embedding_model: str

    def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncIterator[Chunk]: ...

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]: ...

    async def list_models(self) -> list[ModelInfo]: ...

    async def status(self) -> Status: ...

    async def aclose(self) -> None: ...
