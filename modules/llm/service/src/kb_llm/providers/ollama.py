import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .base import Chunk, GenerationOptions, Message, ModelInfo, ModelKind, Status


class OllamaProvider:
    """Talks to a local Ollama server (https://github.com/ollama/ollama)."""

    name = "ollama"

    def __init__(self, base_url: str, chat_model: str, embedding_model: str) -> None:
        self.default_chat_model = chat_model
        self.default_embedding_model = embedding_model
        self._http = httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(300, connect=5))

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncIterator[Chunk]:
        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m.role.value, "content": m.content} for m in messages],
            "stream": True,
        }
        opts = {}
        if options.temperature is not None:
            opts["temperature"] = options.temperature
        if options.max_tokens is not None:
            opts["num_predict"] = options.max_tokens
        if opts:
            body["options"] = opts

        async with self._http.stream("POST", "/api/chat", json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                event = json.loads(line)
                if event.get("done"):
                    yield Chunk(
                        done=True,
                        input_tokens=event.get("prompt_eval_count", 0),
                        output_tokens=event.get("eval_count", 0),
                    )
                    return
                yield Chunk(delta=event.get("message", {}).get("content", ""))

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        resp = await self._http.post("/api/embed", json={"model": model, "input": inputs})
        resp.raise_for_status()
        return resp.json()["embeddings"]

    async def list_models(self) -> list[ModelInfo]:
        resp = await self._http.get("/api/tags")
        resp.raise_for_status()
        models = []
        for m in resp.json().get("models", []):
            name: str = m["name"]
            families = m.get("details", {}).get("families") or []
            is_embedding = "embed" in name or any("bert" in f for f in families)
            models.append(
                ModelInfo(id=name, kind=ModelKind.EMBEDDING if is_embedding else ModelKind.CHAT)
            )
        return models

    async def status(self) -> Status:
        try:
            resp = await self._http.get("/api/version")
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            return Status(healthy=False, detail=f"ollama unreachable: {exc}")
        return Status(healthy=True, detail=f"ollama {resp.json().get('version', '?')}")

    async def aclose(self) -> None:
        await self._http.aclose()
