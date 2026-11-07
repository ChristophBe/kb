import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

import grpc
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_platform.grpc import abort_invalid_argument, violation

from .config import Settings
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
)

log = logging.getLogger("kb_llm")

_Context = grpc.aio.ServicerContext[Any, Any]

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
    def __init__(self, provider: Provider, settings: Settings) -> None:
        self._provider = provider
        self._settings = settings
        self._slots = asyncio.Semaphore(settings.provider_max_concurrency)

    async def ListModels(
        self, request: llm_pb2.ListModelsRequest, context: _Context
    ) -> llm_pb2.ListModelsResponse:
        async with _provider_errors(context):
            models = await self._provider.list_models()
        return llm_pb2.ListModelsResponse(
            models=[
                llm_pb2.Model(id=m.id, provider=self._provider.name, kind=_KINDS[m.kind])
                for m in models
            ]
        )

    async def GetProviderStatus(
        self, request: llm_pb2.GetProviderStatusRequest, context: _Context
    ) -> llm_pb2.GetProviderStatusResponse:
        status = await self._provider.status()
        return llm_pb2.GetProviderStatusResponse(
            provider=self._provider.name,
            healthy=status.healthy,
            detail=status.detail,
            default_chat_model=self._provider.default_chat_model,
            default_embedding_model=self._provider.default_embedding_model,
            embedding_dimensions=self._settings.embedding_dimensions,
        )

    async def Generate(
        self, request: llm_pb2.GenerateRequest, context: _Context
    ) -> AsyncIterator[llm_pb2.GenerateResponse]:
        if not request.messages:
            await abort_invalid_argument(
                context, violation("messages", "At least one message is required")
            )
        model = request.model or self._provider.default_chat_model
        messages = [
            Message(role=_ROLES.get(m.role, Role.USER), content=m.content) for m in request.messages
        ]
        opts = request.options
        options = GenerationOptions(
            temperature=opts.temperature if opts.HasField("temperature") else None,
            max_tokens=opts.max_tokens if opts.HasField("max_tokens") else None,
        )
        async with (
            self._slot(context),
            _provider_errors(context),
            contextlib.aclosing(self._provider.generate(model, messages, options)) as chunks,
            _logged_cancel(model),
        ):
            async for chunk in chunks:
                if chunk.done:
                    yield llm_pb2.GenerateResponse(
                        done=True,
                        model=model,
                        usage=llm_pb2.Usage(
                            input_tokens=chunk.input_tokens, output_tokens=chunk.output_tokens
                        ),
                    )
                elif chunk.delta:
                    yield llm_pb2.GenerateResponse(delta=chunk.delta, model=model)

    async def Embed(
        self, request: llm_pb2.EmbedRequest, context: _Context
    ) -> llm_pb2.EmbedResponse:
        model = request.model or self._provider.default_embedding_model
        if not request.inputs:
            return llm_pb2.EmbedResponse(
                model=model, dimensions=self._settings.embedding_dimensions
            )
        async with self._slot(context), _provider_errors(context):
            vectors = await self._provider.embed(model, list(request.inputs))
        dims = len(vectors[0])
        if dims != self._settings.embedding_dimensions:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                f"model {model} returned {dims}-dim vectors, expected "
                f"{self._settings.embedding_dimensions} (KB_EMBEDDING_DIMENSIONS)",
            )
        return llm_pb2.EmbedResponse(
            model=model,
            dimensions=dims,
            embeddings=[llm_pb2.Embedding(values=v) for v in vectors],
        )

    @contextlib.asynccontextmanager
    async def _slot(self, context: _Context) -> AsyncIterator[None]:
        """Holds a concurrency slot. Calls are rejected, not queued, so a slow
        model can't pile up requests behind it."""
        if self._slots.locked():
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "too many concurrent requests")
        async with self._slots:
            yield


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
