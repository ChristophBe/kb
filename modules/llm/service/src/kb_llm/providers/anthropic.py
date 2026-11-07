import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Literal

import anthropic
from anthropic.types.beta import BetaMessageParam

from .base import (
    Chunk,
    GenerationOptions,
    Message,
    ModelInfo,
    ModelKind,
    ModelNotFoundError,
    NotSupportedError,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    Role,
    Status,
)

log = logging.getLogger("kb_llm")

# Current Claude models offered in ListModels (all chat; Anthropic has no embeddings).
MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1")

# Server-side fallback: if the model declines a request for policy reasons, the API
# retries it on a substitute model inside the same call. "default" lets the API pick
# the substitute; on a model without fallbacks the request runs on that model alone.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"

# Error types the API reports, in a status error's body or a mid-stream error event
# (which arrives on an HTTP 200 response, so its status code says nothing).
_AUTH_TYPES = {"authentication_error", "permission_error"}
_UNAVAILABLE_TYPES = {"overloaded_error", "api_error", "timeout_error"}


@dataclass(frozen=True)
class AnthropicLimits:
    """Timeouts in seconds and retry policy; see kb_llm.config.Settings. The API
    sends pings while a model thinks, so the read timeout only trips on a stall."""

    connect_timeout: float = 5
    read_timeout: float = 120
    request_timeout: float = 600
    status_timeout: float = 10
    # Attempts per call; the SDK retries connection errors, 408, 409, 429 and 5xx
    # (before the first token only) with backoff.
    attempts: int = 3


class AnthropicProvider:
    """Talks to the Anthropic Messages API (Claude) through the official SDK.

    Chat only: Embed raises NotSupportedError, so pair it with an embedding
    provider. Sampling options (temperature) are not sent: current Claude models
    only accept the defaults."""

    name = "anthropic"
    default_embedding_model = ""

    def __init__(
        self,
        api_key: str | None,
        chat_model: str,
        max_tokens: int,
        limits: AnthropicLimits | None = None,
        client: anthropic.AsyncAnthropic | None = None,
    ) -> None:
        if not api_key:
            raise ValueError(
                "KB_ANTHROPIC_API_KEY is not set; it is required when KB_LLM_PROVIDER=anthropic"
            )
        self.default_chat_model = chat_model
        self._max_tokens = max_tokens
        self._limits = limits or AnthropicLimits()
        self._client = client or anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=anthropic.Timeout(
                self._limits.request_timeout,
                connect=self._limits.connect_timeout,
                read=self._limits.read_timeout,
            ),
            max_retries=max(self._limits.attempts - 1, 0),
        )

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
        system, turns = to_anthropic_messages(messages)
        if not turns:
            raise ProviderError("anthropic: the request has no user message")
        try:
            async with self._client.beta.messages.stream(
                model=model,
                max_tokens=options.max_tokens or self._max_tokens,
                system=system or anthropic.omit,
                messages=turns,
                betas=[_FALLBACK_BETA],
                fallbacks="default",
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        yield Chunk(delta=text)
                final = await stream.get_final_message()
        except anthropic.AnthropicError as exc:
            raise translate_error(exc) from exc
        if final.stop_reason == "refusal":
            log.warning("anthropic declined the request (model %s)", model)
        usage = final.usage
        yield Chunk(
            done=True,
            input_tokens=usage.input_tokens
            + (usage.cache_creation_input_tokens or 0)
            + (usage.cache_read_input_tokens or 0),
            output_tokens=usage.output_tokens,
        )

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        raise NotSupportedError(
            "the anthropic provider has no embedding models; use another provider for embeddings"
        )

    async def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id=m, kind=ModelKind.CHAT) for m in MODELS]

    async def status(self) -> Status:
        # Listing one model checks reachability and the key without using tokens.
        try:
            await self._client.with_options(
                timeout=self._limits.status_timeout, max_retries=0
            ).models.list(limit=1)
        except anthropic.AnthropicError as exc:
            return Status(healthy=False, detail=f"anthropic unavailable: {translate_error(exc)}")
        return Status(healthy=True, detail="anthropic api")

    async def aclose(self) -> None:
        await self._client.close()


def to_anthropic_messages(messages: list[Message]) -> tuple[str, list[BetaMessageParam]]:
    """Splits kb messages into the Messages API's top-level system prompt and a
    history that starts with a user turn and alternates roles. System messages
    anywhere are joined into the system prompt; consecutive messages of one role
    are merged; empty messages and assistant turns before the first user turn
    (which the API rejects) are dropped."""
    system: list[str] = []
    turns: list[tuple[Literal["user", "assistant"], list[str]]] = []
    for m in messages:
        if not m.content.strip():
            continue
        if m.role == Role.SYSTEM:
            system.append(m.content)
            continue
        role: Literal["user", "assistant"] = "assistant" if m.role == Role.ASSISTANT else "user"
        if turns and turns[-1][0] == role:
            turns[-1][1].append(m.content)
        elif turns or role == "user":
            turns.append((role, [m.content]))
    params: list[BetaMessageParam] = []
    for role, parts in turns:
        text = "\n\n".join(parts)
        if role == "user":
            params.append({"role": "user", "content": text})
        else:
            params.append({"role": "assistant", "content": text})
    return "\n\n".join(system), params


def translate_error(exc: anthropic.AnthropicError) -> ProviderError:
    if isinstance(exc, anthropic.APIConnectionError):  # includes timeouts
        return ProviderUnavailableError(f"anthropic unreachable: {type(exc).__name__}")
    if not isinstance(exc, anthropic.APIStatusError):
        return ProviderError(f"anthropic request failed: {exc}")
    kind = exc.type or ""
    code = exc.status_code
    detail = f"anthropic returned {kind or code} (request {exc.request_id})"
    if kind in _AUTH_TYPES or code in (401, 403):
        return ProviderAuthError(detail)
    if kind == "rate_limit_error" or code == 429:
        return ProviderRateLimitedError(detail)
    if kind == "not_found_error" or code == 404:
        return ModelNotFoundError("anthropic does not have the requested model")
    if kind in _UNAVAILABLE_TYPES or code >= 500:
        return ProviderUnavailableError(detail)
    return ProviderError(detail)
