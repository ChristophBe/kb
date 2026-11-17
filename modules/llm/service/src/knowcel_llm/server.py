import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import grpc
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc
from knowcel_platform.grpc import (
    abort_invalid_argument,
    current_principal,
    current_user,
    violation,
)
from prometheus_client import Counter, Histogram
from sqlalchemy.exc import SQLAlchemyError

from .config import Settings
from .providers import Providers
from .providers.base import (
    GenerationOptions,
    Message,
    ModelKind,
    ModelNotFoundError,
    NotSupportedError,
    Provider,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitedError,
    ProviderUnavailableError,
    Role,
    Status,
)
from .usage import UsageRecord, UsageStore

log = logging.getLogger("knowcel_llm")

_Context = grpc.aio.ServicerContext[Any, Any]

# Metrics (docs/metrics.md). Only successful calls are recorded, so the model
# label holds models the provider has; failures are in the gRPC server
# metrics by status code.
_LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 300, 600)
GENERATION_SECONDS = Histogram(
    "kb_llm_generation_duration_seconds",
    "Time a generation took from the request to the last token.",
    ["provider", "model"],
    buckets=_LATENCY_BUCKETS,
)
FIRST_TOKEN_SECONDS = Histogram(
    "kb_llm_generation_first_token_seconds",
    "Time from a generation request to its first token.",
    ["provider", "model"],
    buckets=_LATENCY_BUCKETS,
)
TOKENS = Counter(
    "kb_llm_tokens",
    "Tokens of generations as the provider reports them, by direction (input or output).",
    ["provider", "model", "direction"],
)
EMBEDDING_SECONDS = Histogram(
    "kb_llm_embedding_duration_seconds",
    "Time an Embed call took at the provider, for all its inputs.",
    ["provider", "model"],
    buckets=_LATENCY_BUCKETS,
)
EMBEDDING_INPUTS = Counter(
    "kb_llm_embedding_inputs",
    "Texts embedded (the provider interface reports no token counts for embeddings).",
    ["provider", "model"],
)

# Seconds recording a generation's usage may take before it is given up, so a
# slow database can't hold back the end of an answer.
_RECORD_TIMEOUT = 2
_UNKNOWN_CALLER = "unknown"
_MAX_RERANK_DOCUMENTS = 50
_DEFAULT_USAGE_DAYS = 30
_MAX_USAGE_DAYS = 366

_ROLES = {
    llm_pb2.ROLE_SYSTEM: Role.SYSTEM,
    llm_pb2.ROLE_USER: Role.USER,
    llm_pb2.ROLE_ASSISTANT: Role.ASSISTANT,
}
_KINDS = {
    ModelKind.CHAT: llm_pb2.MODEL_KIND_CHAT,
    ModelKind.EMBEDDING: llm_pb2.MODEL_KIND_EMBEDDING,
}


class LlmServicer(llm_pb2_grpc.LlmServiceServicer):
    """Serves Generate from the chat provider and Embed from the embedding
    provider, which may be the same one."""

    def __init__(
        self, providers: Providers, settings: Settings, usage: UsageStore | None = None
    ) -> None:
        self._usage = usage
        self._chat = providers.chat
        self._embedding = providers.embedding
        self._split = providers.split
        self._settings = settings
        # A concurrency limit per provider, shared when one serves both tasks.
        self._chat_slots = asyncio.Semaphore(settings.provider_max_concurrency)
        self._embedding_slots = (
            asyncio.Semaphore(settings.provider_max_concurrency)
            if self._split
            else self._chat_slots
        )

    async def ListModels(
        self, request: llm_pb2.ListModelsRequest, context: _Context
    ) -> llm_pb2.ListModelsResponse:
        async with _provider_errors(context):
            if not self._split:
                chat_models = embedding_models = await self._chat.list_models()
            else:
                chat_models, embedding_models = await asyncio.gather(
                    self._chat.list_models(), self._embedding.list_models()
                )
        return llm_pb2.ListModelsResponse(
            models=[
                llm_pb2.Model(id=m.id, provider=provider.name, kind=_KINDS[m.kind])
                for provider, models, kind in (
                    (self._chat, chat_models, ModelKind.CHAT),
                    (self._embedding, embedding_models, ModelKind.EMBEDDING),
                )
                for m in models
                if m.kind is kind
            ]
        )

    async def GetProviderStatus(
        self, request: llm_pb2.GetProviderStatusRequest, context: _Context
    ) -> llm_pb2.GetProviderStatusResponse:
        if not self._split:
            chat = embedding = await self._chat.status()
            name, detail = self._chat.name, chat.detail
        else:
            chat, embedding = await asyncio.gather(self._chat.status(), self._embedding.status())
            name = f"{self._chat.name}+{self._embedding.name}"
            detail = f"chat: {chat.detail}; embedding: {embedding.detail}"
        return llm_pb2.GetProviderStatusResponse(
            provider=name,
            healthy=chat.healthy and embedding.healthy,
            detail=detail,
            default_chat_model=self._chat.default_chat_model,
            default_embedding_model=self._embedding.default_embedding_model,
            embedding_dimensions=self._settings.embedding_dimensions,
            chat=_health(self._chat, chat),
            embedding=_health(self._embedding, embedding),
        )

    async def Generate(
        self, request: llm_pb2.GenerateRequest, context: _Context
    ) -> AsyncIterator[llm_pb2.GenerateResponse]:
        if not request.messages:
            await abort_invalid_argument(
                context, violation("messages", "At least one message is required")
            )
        model = request.model or self._chat.default_chat_model
        log.info("Generate with model %s", model)
        messages = [
            Message(role=_ROLES.get(m.role, Role.USER), content=m.content) for m in request.messages
        ]
        opts = request.options
        options = GenerationOptions(
            temperature=opts.temperature if opts.HasField("temperature") else None,
            max_tokens=opts.max_tokens if opts.HasField("max_tokens") else None,
        )
        async with (
            _slot(self._chat_slots, context),
            _provider_errors(context),
            contextlib.aclosing(self._chat.generate(model, messages, options)) as chunks,
            _logged_cancel(model),
        ):
            provider = self._chat.name
            start = time.perf_counter()
            first = True
            async for chunk in chunks:
                if first and (chunk.delta or chunk.done):
                    FIRST_TOKEN_SECONDS.labels(provider, model).observe(time.perf_counter() - start)
                    first = False
                if chunk.done:
                    GENERATION_SECONDS.labels(provider, model).observe(time.perf_counter() - start)
                    TOKENS.labels(provider, model, "input").inc(chunk.input_tokens)
                    TOKENS.labels(provider, model, "output").inc(chunk.output_tokens)
                    await self._record_usage(
                        UsageRecord(
                            user_id=current_user() or "",
                            caller_module=request.caller_module[:64] or _UNKNOWN_CALLER,
                            provider=provider,
                            model=model,
                            input_tokens=chunk.input_tokens,
                            output_tokens=chunk.output_tokens,
                            latency_ms=round((time.perf_counter() - start) * 1000),
                        )
                    )
                    yield llm_pb2.GenerateResponse(
                        done=True,
                        model=model,
                        usage=llm_pb2.Usage(
                            input_tokens=chunk.input_tokens, output_tokens=chunk.output_tokens
                        ),
                    )
                elif chunk.delta:
                    yield llm_pb2.GenerateResponse(delta=chunk.delta, model=model)

    async def _record_usage(self, record: UsageRecord) -> None:
        """Keeps the usage of a generation. A failure is logged and never
        reaches the caller, whose answer is complete."""
        if self._usage is None:
            return
        try:
            await asyncio.wait_for(self._usage.record(record), _RECORD_TIMEOUT)
        except Exception:
            log.exception("recording the usage of a generation failed")

    async def GetUsage(
        self, request: llm_pb2.GetUsageRequest, context: _Context
    ) -> llm_pb2.GetUsageResponse:
        user = current_user()
        if user is None:
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "sign in to see the usage")
        principal = current_principal()
        days = request.days or _DEFAULT_USAGE_DAYS
        if not 1 <= days <= _MAX_USAGE_DAYS:
            await abort_invalid_argument(
                context, violation("days", f"Days must be between 1 and {_MAX_USAGE_DAYS}")
            )
        if self._usage is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "usage is not recorded")
        # Fails closed like _require_platform_admin: without a principal, only
        # the caller's own usage.
        everyone = principal is not None and principal.platform_admin
        try:
            sums = await self._usage.summarize(days, None if everyone else user)
        except (SQLAlchemyError, OSError) as exc:
            log.error("reading the usage failed: %s", exc)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "the usage is unavailable")
        return llm_pb2.GetUsageResponse(
            entries=[
                llm_pb2.UsageEntry(
                    date=s.date,
                    provider=s.provider,
                    model=s.model,
                    caller_module=s.caller_module,
                    requests=s.requests,
                    input_tokens=s.input_tokens,
                    output_tokens=s.output_tokens,
                )
                for s in sums
            ]
        )

    async def PullModel(
        self, request: llm_pb2.PullModelRequest, context: _Context
    ) -> AsyncIterator[llm_pb2.PullModelResponse]:
        await _require_platform_admin(context)
        provider = await self._managed(request.provider, request.model, context)
        log.info("PullModel %s on %s", request.model, provider.name)
        async with (
            _provider_errors(context),
            contextlib.aclosing(provider.pull_model(request.model)) as steps,
        ):
            async for step in steps:
                yield llm_pb2.PullModelResponse(
                    status=step.status, completed=step.completed, total=step.total, done=step.done
                )

    async def DeleteModel(
        self, request: llm_pb2.DeleteModelRequest, context: _Context
    ) -> llm_pb2.DeleteModelResponse:
        await _require_platform_admin(context)
        provider = await self._managed(request.provider, request.model, context)
        log.info("DeleteModel %s on %s", request.model, provider.name)
        async with _provider_errors(context):
            await provider.delete_model(request.model)
        return llm_pb2.DeleteModelResponse()

    async def _managed(self, name: str, model: str, context: _Context) -> Provider:
        """The provider `name` (empty: the chat provider) of a model change."""
        if not model:
            await abort_invalid_argument(context, violation("model", "A model is required"))
        provider = next((p for p in (self._chat, self._embedding) if name in ("", p.name)), None)
        if provider is None:
            await abort_invalid_argument(
                context, violation("provider", f"{name} is not a configured provider")
            )
        return provider

    async def Embed(
        self, request: llm_pb2.EmbedRequest, context: _Context
    ) -> llm_pb2.EmbedResponse:
        model = request.model or self._embedding.default_embedding_model
        if not request.inputs:
            return llm_pb2.EmbedResponse(
                model=model, dimensions=self._settings.embedding_dimensions
            )
        async with _slot(self._embedding_slots, context), _provider_errors(context):
            start = time.perf_counter()
            vectors = await self._embedding.embed(model, list(request.inputs))
        elapsed = time.perf_counter() - start
        dims = len(vectors[0])
        if dims != self._settings.embedding_dimensions:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                f"model {model} returned {dims}-dim vectors, expected "
                f"{self._settings.embedding_dimensions} (KNOWCEL_EMBEDDING_DIMENSIONS)",
            )
        EMBEDDING_SECONDS.labels(self._embedding.name, model).observe(elapsed)
        EMBEDDING_INPUTS.labels(self._embedding.name, model).inc(len(request.inputs))
        return llm_pb2.EmbedResponse(
            model=model,
            dimensions=dims,
            embeddings=[llm_pb2.Embedding(values=v) for v in vectors],
        )

    async def Rerank(
        self, request: llm_pb2.RerankRequest, context: _Context
    ) -> llm_pb2.RerankResponse:
        model = request.model or self._chat.default_chat_model
        if not request.query.strip():
            await abort_invalid_argument(context, violation("query", "A query is required"))
        if len(request.documents) > _MAX_RERANK_DOCUMENTS:
            await abort_invalid_argument(
                context,
                violation("documents", f"At most {_MAX_RERANK_DOCUMENTS} documents can be ranked"),
            )
        if not request.documents:
            return llm_pb2.RerankResponse(model=model)
        async with _slot(self._chat_slots, context), _provider_errors(context):
            scores = await self._chat.rerank(model, request.query, list(request.documents))
        return llm_pb2.RerankResponse(model=model, scores=scores)


@contextlib.asynccontextmanager
async def _slot(slots: asyncio.Semaphore, context: _Context) -> AsyncIterator[None]:
    """Holds a concurrency slot. Calls are rejected, not queued, so a slow
    model can't pile up requests behind it."""
    if slots.locked():
        await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "too many concurrent requests")
    async with slots:
        yield


async def _require_platform_admin(context: _Context) -> None:
    """Rejects callers who are not platform admins. Fails closed: without a
    caller, or while iam can't say who they are, nobody is an admin."""
    principal = current_principal()
    if principal is None or not principal.platform_admin:
        await context.abort(
            grpc.StatusCode.PERMISSION_DENIED, "only platform admins can change models"
        )


def _health(provider: Provider, status: Status) -> llm_pb2.ProviderHealth:
    return llm_pb2.ProviderHealth(
        provider=provider.name, healthy=status.healthy, detail=status.detail
    )


@contextlib.asynccontextmanager
async def _logged_cancel(model: str) -> AsyncIterator[None]:
    """Logs a Generate call the client cancelled (a stopped answer, a closed
    tab). Leaving the context closes the provider stream, which stops the model."""
    try:
        yield
    except (asyncio.CancelledError, GeneratorExit):
        log.info("Generate cancelled by the client (model %s)", model)
        raise


@contextlib.asynccontextmanager
async def _provider_errors(context: _Context) -> AsyncIterator[None]:
    """Maps provider failures to gRPC statuses; the cause is only logged."""
    try:
        yield
    except ProviderRateLimitedError as exc:
        log.warning("provider rate limited: %s", exc)
        await context.abort(
            grpc.StatusCode.RESOURCE_EXHAUSTED, "the model provider is rate limited"
        )
    except ProviderUnavailableError as exc:
        log.warning("provider unavailable: %s", exc)
        await context.abort(grpc.StatusCode.UNAVAILABLE, "the model provider is unavailable")
    except ModelNotFoundError as exc:
        await context.abort(grpc.StatusCode.NOT_FOUND, str(exc))
    except NotSupportedError as exc:
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, str(exc))
    except ProviderAuthError as exc:
        log.error("provider rejected its credentials: %s", exc)
        await context.abort(
            grpc.StatusCode.FAILED_PRECONDITION, "the model provider rejected kb's credentials"
        )
    except ProviderError as exc:
        log.error("provider call failed: %s", exc)
        await context.abort(grpc.StatusCode.INTERNAL, "provider call failed")
