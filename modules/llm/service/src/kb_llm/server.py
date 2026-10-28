from collections.abc import AsyncIterator

import grpc
from kb.llm.v1 import llm_pb2, llm_pb2_grpc

from .config import Settings
from .providers.base import GenerationOptions, Message, ModelKind, Provider, Role

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

    async def ListModels(self, request, context) -> llm_pb2.ListModelsResponse:
        models = await self._provider.list_models()
        return llm_pb2.ListModelsResponse(
            models=[
                llm_pb2.Model(id=m.id, provider=self._provider.name, kind=_KINDS[m.kind])
                for m in models
            ]
        )

    async def GetProviderStatus(self, request, context) -> llm_pb2.GetProviderStatusResponse:
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
        self, request: llm_pb2.GenerateRequest, context: grpc.aio.ServicerContext
    ) -> AsyncIterator[llm_pb2.GenerateResponse]:
        if not request.messages:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "messages must not be empty")
        model = request.model or self._provider.default_chat_model
        messages = [
            Message(role=_ROLES.get(m.role, Role.USER), content=m.content) for m in request.messages
        ]
        opts = request.options
        options = GenerationOptions(
            temperature=opts.temperature if opts.HasField("temperature") else None,
            max_tokens=opts.max_tokens if opts.HasField("max_tokens") else None,
        )
        async for chunk in self._provider.generate(model, messages, options):
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

    async def Embed(self, request: llm_pb2.EmbedRequest, context) -> llm_pb2.EmbedResponse:
        model = request.model or self._provider.default_embedding_model
        if not request.inputs:
            return llm_pb2.EmbedResponse(
                model=model, dimensions=self._settings.embedding_dimensions
            )
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
