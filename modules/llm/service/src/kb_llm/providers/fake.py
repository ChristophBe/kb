import hashlib
import math
from collections.abc import AsyncIterator

from .base import Chunk, GenerationOptions, Message, ModelInfo, ModelKind, Status


class FakeProvider:
    """Deterministic provider for tests and for running the stack without a
    model server. Generation echoes the last user message; embeddings are
    derived from a hash so identical text gets identical vectors."""

    name = "fake"
    default_chat_model = "fake-chat"
    default_embedding_model = "fake-embed"

    def __init__(self, dimensions: int) -> None:
        self._dimensions = dimensions

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncIterator[Chunk]:
        last = messages[-1].content if messages else ""
        words = f"(fake answer) You said: {last}".split(" ")
        for i, word in enumerate(words):
            yield Chunk(delta=word if i == 0 else " " + word)
        yield Chunk(
            done=True,
            input_tokens=sum(len(m.content.split()) for m in messages),
            output_tokens=len(words),
        )

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in inputs]

    def _vector(self, text: str) -> list[float]:
        values: list[float] = []
        counter = 0
        while len(values) < self._dimensions:
            digest = hashlib.sha256(f"{counter}:{text}".encode()).digest()
            values.extend((b - 127.5) / 127.5 for b in digest)
            counter += 1
        values = values[: self._dimensions]
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [v / norm for v in values]

    async def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(id=self.default_chat_model, kind=ModelKind.CHAT),
            ModelInfo(id=self.default_embedding_model, kind=ModelKind.EMBEDDING),
        ]

    async def status(self) -> Status:
        return Status(healthy=True, detail="fake provider")

    async def aclose(self) -> None:
        return None
