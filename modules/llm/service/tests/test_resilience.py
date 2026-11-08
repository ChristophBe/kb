import asyncio
import json
import time
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable

import grpc
import httpx
import pytest
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_llm.config import Settings
from kb_llm.providers import Providers
from kb_llm.providers.base import (
    Chunk,
    GenerationOptions,
    Message,
    ModelInfo,
    ModelNotFoundError,
    Provider,
    ProviderError,
    ProviderUnavailableError,
    Role,
    Status,
)
from kb_llm.providers.fake import FakeProvider
from kb_llm.providers.ollama import OllamaLimits, OllamaProvider
from kb_llm.server import LlmServicer

FAST_RETRIES = OllamaLimits(retry_delay=0)
HELLO = llm_pb2.GenerateRequest(messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hi")])


class FailingProvider(FakeProvider):
    """Raises the given error from every provider call."""

    def __init__(self, error: ProviderError) -> None:
        super().__init__(16)
        self._error = error

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
        raise self._error
        yield Chunk()

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        raise self._error

    async def list_models(self) -> list[ModelInfo]:
        raise self._error


class SlowProvider(FakeProvider):
    """Blocks every generation and embedding until released."""

    def __init__(self) -> None:
        super().__init__(16)
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
        self.started.set()
        await self.release.wait()
        yield Chunk(done=True)

    async def embed(self, model: str, inputs: list[str]) -> list[list[float]]:
        self.started.set()
        await self.release.wait()
        return await super().embed(model, inputs)

    async def status(self) -> Status:
        return Status(healthy=True)


Serve = Callable[[Provider], Awaitable[llm_pb2_grpc.LlmServiceStub]]


@pytest.fixture
async def serve() -> AsyncIterator[Serve]:
    servers: list[grpc.aio.Server] = []
    channels: list[grpc.aio.Channel] = []

    async def start(provider: Provider) -> llm_pb2_grpc.LlmServiceStub:
        settings = Settings(embedding_dimensions=16, provider_max_concurrency=1)
        server = grpc.aio.server()
        llm_pb2_grpc.add_LlmServiceServicer_to_server(
            LlmServicer(Providers(provider, provider), settings), server
        )
        port = server.add_insecure_port("127.0.0.1:0")
        await server.start()
        channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
        servers.append(server)
        channels.append(channel)
        return llm_pb2_grpc.LlmServiceStub(channel)

    yield start
    for channel in channels:
        await channel.close()
    for server in servers:
        await server.stop(None)


def ollama(
    handler: Callable[[httpx.Request], httpx.Response],
    limits: OllamaLimits = FAST_RETRIES,
) -> OllamaProvider:
    return OllamaProvider(
        "http://ollama", "chat", "embed", limits, transport=httpx.MockTransport(handler)
    )


async def embed_is_accepted(stub: llm_pb2_grpc.LlmServiceStub) -> bool:
    try:
        await stub.Embed(llm_pb2.EmbedRequest(inputs=["a"]))
    except grpc.aio.AioRpcError as err:
        if err.code() != grpc.StatusCode.RESOURCE_EXHAUSTED:
            raise
        return False
    return True


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (ProviderUnavailableError("down"), grpc.StatusCode.UNAVAILABLE),
        (ModelNotFoundError("no such model"), grpc.StatusCode.NOT_FOUND),
        (ProviderError("boom"), grpc.StatusCode.INTERNAL),
    ],
)
async def test_provider_errors_map_to_status_on_every_rpc(
    serve: Serve, error: ProviderError, code: grpc.StatusCode
) -> None:
    stub = await serve(FailingProvider(error))
    with pytest.raises(grpc.aio.AioRpcError) as generate:
        [r async for r in stub.Generate(HELLO)]
    with pytest.raises(grpc.aio.AioRpcError) as embed:
        await stub.Embed(llm_pb2.EmbedRequest(inputs=["a"]))
    with pytest.raises(grpc.aio.AioRpcError) as models:
        await stub.ListModels(llm_pb2.ListModelsRequest())
    assert {generate.value.code(), embed.value.code(), models.value.code()} == {code}


async def test_internal_errors_do_not_leak_the_cause(serve: Serve) -> None:
    stub = await serve(FailingProvider(ProviderError("secret detail")))
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.Embed(llm_pb2.EmbedRequest(inputs=["a"]))
    assert "secret" not in (err.value.details() or "")


async def test_requests_above_the_limit_are_rejected(serve: Serve) -> None:
    provider = SlowProvider()
    stub = await serve(provider)
    running = stub.Generate(HELLO)
    first = asyncio.ensure_future(running.read())
    await asyncio.wait_for(provider.started.wait(), 5)

    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.Embed(llm_pb2.EmbedRequest(inputs=["a"]))
    assert err.value.code() == grpc.StatusCode.RESOURCE_EXHAUSTED
    with pytest.raises(grpc.aio.AioRpcError) as err:
        [r async for r in stub.Generate(HELLO)]
    assert err.value.code() == grpc.StatusCode.RESOURCE_EXHAUSTED

    # Status stays available while saturated, and the slot frees up afterwards.
    assert (await stub.GetProviderStatus(llm_pb2.GetProviderStatusRequest())).healthy
    provider.release.set()
    await first
    assert (await stub.Embed(llm_pb2.EmbedRequest(inputs=["a"]))).dimensions == 16


async def test_a_cancelled_generation_frees_its_slot(serve: Serve) -> None:
    provider = SlowProvider()
    stub = await serve(provider)
    running = stub.Generate(HELLO)
    first = asyncio.ensure_future(running.read())
    await asyncio.wait_for(provider.started.wait(), 5)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first

    # The server notices the cancellation asynchronously.
    provider.release.set()
    for _ in range(500):
        if await embed_is_accepted(stub):
            return
        await asyncio.sleep(0.01)
    pytest.fail("the slot was never released")


async def test_refused_connection_fails_fast_without_retries() -> None:
    calls = 0

    def refuse(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderUnavailableError):
        await ollama(refuse).embed("embed", ["a"])
    assert calls == 1


async def test_unreachable_host_gives_up_within_the_connect_timeout() -> None:
    # 192.0.2.0/24 (TEST-NET-1) is reserved and never routed, so it either
    # blackholes or is refused; both must end within the connect timeout.
    provider = OllamaProvider(
        "http://192.0.2.1:11434", "chat", "embed", OllamaLimits(connect_timeout=0.2, retry_delay=0)
    )
    started = time.monotonic()
    with pytest.raises(ProviderUnavailableError):
        await provider.embed("embed", ["a"])
    assert time.monotonic() - started < 1
    await provider.aclose()


async def test_transient_failures_are_retried() -> None:
    responses = iter(
        [httpx.Response(503), httpx.Response(200, json={"embeddings": [[1.0]]})],
    )

    def respond(request: httpx.Request) -> httpx.Response:
        return next(responses)

    assert await ollama(respond).embed("embed", ["a"]) == [[1.0]]


async def test_retries_stop_after_the_configured_attempts() -> None:
    calls = 0

    def overloaded(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    with pytest.raises(ProviderUnavailableError):
        await ollama(overloaded).list_models()
    assert calls == FAST_RETRIES.attempts


async def test_read_timeouts_are_not_retried() -> None:
    calls = 0

    def stall(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("slow")

    with pytest.raises(ProviderUnavailableError):
        await ollama(stall).embed("embed", ["a"])
    assert calls == 1


async def test_unknown_model_is_not_retried() -> None:
    calls = 0

    def missing(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404)

    with pytest.raises(ModelNotFoundError):
        await ollama(missing).embed("embed", ["a"])
    assert calls == 1


async def test_generate_is_never_retried() -> None:
    calls = 0

    def overloaded(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    with pytest.raises(ProviderUnavailableError):
        [c async for c in ollama(overloaded).generate("chat", [], GenerationOptions())]
    assert calls == 1


async def test_generate_uses_the_first_token_timeout() -> None:
    timeouts: dict[str, float] = {}

    def capture(request: httpx.Request) -> httpx.Response:
        timeouts.update(request.extensions["timeout"])
        return httpx.Response(200, content=json.dumps({"done": True}))

    limits = OllamaLimits(first_token_timeout=7, connect_timeout=2)
    chunks = [c async for c in ollama(capture, limits).generate("chat", [], GenerationOptions())]
    assert chunks[-1].done
    assert timeouts["read"] == 7
    assert timeouts["connect"] == 2


async def test_generate_stops_at_the_total_time_limit() -> None:
    lines = [json.dumps({"message": {"content": "x"}}) for _ in range(3)]

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content="\n".join(lines))

    provider = ollama(respond, OllamaLimits(generate_timeout=0))
    with pytest.raises(ProviderUnavailableError, match="time limit"):
        [c async for c in provider.generate("chat", [], GenerationOptions())]


async def test_generate_surfaces_an_error_event_from_the_stream() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"error": "out of memory"}))

    with pytest.raises(ProviderError, match="out of memory"):
        [c async for c in ollama(respond).generate("chat", [], GenerationOptions())]


class EndlessProvider(FakeProvider):
    """Streams words until the stream is closed, and records that it was."""

    def __init__(self) -> None:
        super().__init__(16)
        self.streaming = asyncio.Event()
        self.closed = asyncio.Event()

    async def generate(
        self, model: str, messages: list[Message], options: GenerationOptions
    ) -> AsyncGenerator[Chunk]:
        try:
            while True:
                yield Chunk(delta="word ")
                self.streaming.set()
                await asyncio.sleep(0.01)
        finally:
            self.closed.set()


async def test_a_cancelled_generate_closes_the_provider_stream_and_frees_its_slot(
    serve: Serve, caplog: pytest.LogCaptureFixture
) -> None:
    provider = EndlessProvider()
    stub = await serve(provider)
    call = stub.Generate(HELLO)
    assert (await call.read()).delta == "word "
    await provider.streaming.wait()

    with caplog.at_level("INFO", logger="kb_llm"):
        call.cancel()
        async with asyncio.timeout(1):
            await provider.closed.wait()
    assert "Generate cancelled by the client" in caplog.text
    # The only slot (provider_max_concurrency=1) is free again.
    assert await embed_is_accepted(stub)


async def test_the_fake_provider_can_stream_slowly() -> None:
    provider = FakeProvider(16, token_delay=0.05)
    started = time.monotonic()
    chunks = [
        c async for c in provider.generate("m", [Message(Role.USER, "hi")], GenerationOptions())
    ]
    assert time.monotonic() - started >= 0.05 * (len(chunks) - 1)
    assert chunks[-1].done
