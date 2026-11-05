import asyncio
import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

import httpx

from .base import (
    Chunk,
    GenerationOptions,
    Message,
    ModelInfo,
    ModelKind,
    ModelNotFoundError,
    ProviderError,
    ProviderUnavailableError,
    Status,
)

# Statuses that mean "overloaded or restarting" rather than a bad request.
_RETRYABLE_STATUS = {429, 502, 503, 504}


@dataclass(frozen=True)
class OllamaLimits:
    """Timeouts in seconds and retry policy; see kb_llm.config.Settings."""

    connect_timeout: float = 5
    first_token_timeout: float = 120
    generate_timeout: float = 600
    embed_timeout: float = 120
    list_timeout: float = 10
    attempts: int = 3
    retry_delay: float = 0.5


class OllamaProvider:
    """Talks to a local Ollama server (https://github.com/ollama/ollama)."""

    name = "ollama"

    def __init__(
        self,
        base_url: str,
        chat_model: str,
        embedding_model: str,
        limits: OllamaLimits | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.default_chat_model = chat_model
        self.default_embedding_model = embedding_model
        self._limits = limits or OllamaLimits()
        self._http = httpx.AsyncClient(
            base_url=base_url, timeout=self._timeout(self._limits.list_timeout), transport=transport
        )

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
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

        # Ollama sends nothing until the first token, so the read timeout covers
        # the wait for it, and any later stall; the deadline bounds the whole answer.
        deadline = asyncio.get_running_loop().time() + self._limits.generate_timeout
        timeout = self._timeout(self._limits.first_token_timeout)
        try:
            async with self._http.stream("POST", "/api/chat", json=body, timeout=timeout) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    event = json.loads(line)
                    if "error" in event:
                        raise ProviderError(f"ollama: {event['error']}")
                    if event.get("done"):
                        yield Chunk(
                            done=True,
                            input_tokens=event.get("prompt_eval_count", 0),
                            output_tokens=event.get("eval_count", 0),
                        )
                        return
                    if asyncio.get_running_loop().time() > deadline:
                        raise ProviderUnavailableError("ollama generation exceeded its time limit")
                    yield Chunk(delta=event.get("message", {}).get("content", ""))
        except httpx.HTTPError as exc:
            raise _translate(exc) from exc

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        resp = await self._idempotent(
            "POST",
            "/api/embed",
            self._limits.embed_timeout,
            json={"model": model, "input": inputs},
        )
        return resp.json()["embeddings"]

    async def list_models(self) -> list[ModelInfo]:
        resp = await self._idempotent("GET", "/api/tags", self._limits.list_timeout)
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

    def _timeout(self, seconds: float) -> httpx.Timeout:
        return httpx.Timeout(seconds, connect=self._limits.connect_timeout)

    async def _idempotent(
        self, method: str, path: str, seconds: float, json: dict[str, Any] | None = None
    ) -> httpx.Response:
        for attempt in range(self._limits.attempts):
            try:
                resp = await self._http.request(
                    method, path, json=json, timeout=self._timeout(seconds)
                )
                resp.raise_for_status()
                return resp
            except httpx.HTTPError as exc:
                if attempt == self._limits.attempts - 1 or not _retryable(exc):
                    raise _translate(exc) from exc
            await asyncio.sleep(self._limits.retry_delay * 2**attempt)
        raise ProviderError("ollama: no attempts configured")


def _retryable(exc: httpx.HTTPError) -> bool:
    """Transient failures only. A refused or timed-out connection would make callers
    wait several connect timeouts, and repeating a slow call adds to the pile-up."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    return isinstance(exc, httpx.TransportError) and not isinstance(
        exc, httpx.ConnectError | httpx.TimeoutException
    )


def _translate(exc: httpx.HTTPError) -> ProviderError:
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 404:
            return ModelNotFoundError("ollama does not have the requested model")
        if code in _RETRYABLE_STATUS:
            return ProviderUnavailableError(f"ollama returned {code}")
        return ProviderError(f"ollama returned {code}")
    if isinstance(exc, httpx.TimeoutException):
        return ProviderUnavailableError(f"ollama timed out: {type(exc).__name__}")
    if isinstance(exc, httpx.TransportError):
        return ProviderUnavailableError(f"ollama unreachable: {exc}")
    return ProviderError(f"ollama request failed: {exc}")
