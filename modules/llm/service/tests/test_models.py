import json
from collections.abc import AsyncGenerator, AsyncIterator

import grpc
import httpx
import pytest
from knowcel.iam.v1 import iam_pb2
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc
from knowcel_llm.callers import resolver
from knowcel_llm.config import Settings
from knowcel_llm.providers import Providers
from knowcel_llm.providers.anthropic import AnthropicProvider
from knowcel_llm.providers.base import ModelNotFoundError, NotSupportedError, PullProgress
from knowcel_llm.providers.fake import FakeProvider
from knowcel_llm.providers.ollama import OllamaLimits, OllamaProvider
from knowcel_llm.server import LlmServicer
from knowcel_platform.grpc import USER_HEADER, Principal, PrincipalResolver, UserInterceptor

ADMIN = ((USER_HEADER, "root"),)
MEMBER = ((USER_HEADER, "mia"),)


class ManagedProvider(FakeProvider):
    """A fake provider that can pull and delete models."""

    name = "managed"

    def __init__(self) -> None:
        super().__init__(16)
        self.pulled: list[str] = []
        self.deleted: list[str] = []

    async def pull_model(self, model: str) -> AsyncGenerator[PullProgress]:
        self.pulled.append(model)
        yield PullProgress(status="pulling manifest")
        yield PullProgress(status="pulling abc", completed=50, total=100)
        yield PullProgress(status="success", done=True)

    async def delete_model(self, model: str) -> None:
        if model == "missing":
            raise ModelNotFoundError("no such model")
        self.deleted.append(model)


class Server:
    def __init__(self, stub: llm_pb2_grpc.LlmServiceStub, managed: ManagedProvider) -> None:
        self.stub = stub
        self.managed = managed


async def _principal(user: str) -> Principal:
    return Principal(user, platform_admin=user == "root")


async def _serve(
    providers: Providers, resolve: object = _principal
) -> AsyncIterator[llm_pb2_grpc.LlmServiceStub]:
    settings = Settings(embedding_dimensions=16)
    server = grpc.aio.server(interceptors=[UserInterceptor(PrincipalResolver(resolve))])  # type: ignore[arg-type]
    llm_pb2_grpc.add_LlmServiceServicer_to_server(LlmServicer(providers, settings), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield llm_pb2_grpc.LlmServiceStub(channel)
    await server.stop(None)


@pytest.fixture
async def managed() -> AsyncIterator[Server]:
    provider = ManagedProvider()
    async for stub in _serve(Providers(provider, provider)):
        yield Server(stub, provider)


@pytest.fixture
async def unmanaged() -> AsyncIterator[llm_pb2_grpc.LlmServiceStub]:
    provider = FakeProvider(16)
    async for stub in _serve(Providers(provider, provider)):
        yield stub


async def _pull(
    stub: llm_pb2_grpc.LlmServiceStub,
    model: str = "llama3.2",
    provider: str = "",
    metadata: tuple[tuple[str, str], ...] = ADMIN,
) -> list[llm_pb2.PullModelResponse]:
    request = llm_pb2.PullModelRequest(provider=provider, model=model)
    return [r async for r in stub.PullModel(request, metadata=metadata)]


async def test_admin_pulls_a_model_with_progress(managed: Server) -> None:
    steps = await _pull(managed.stub)
    assert [(s.status, s.completed, s.total, s.done) for s in steps] == [
        ("pulling manifest", 0, 0, False),
        ("pulling abc", 50, 100, False),
        ("success", 0, 0, True),
    ]
    assert managed.managed.pulled == ["llama3.2"]


async def test_admin_deletes_a_model(managed: Server) -> None:
    await managed.stub.DeleteModel(llm_pb2.DeleteModelRequest(model="llama3.2"), metadata=ADMIN)
    assert managed.managed.deleted == ["llama3.2"]
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await managed.stub.DeleteModel(llm_pb2.DeleteModelRequest(model="missing"), metadata=ADMIN)
    assert err.value.code() == grpc.StatusCode.NOT_FOUND


async def test_non_admin_is_denied_but_can_list(managed: Server) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as pull:
        await _pull(managed.stub, metadata=MEMBER)
    assert pull.value.code() == grpc.StatusCode.PERMISSION_DENIED
    with pytest.raises(grpc.aio.AioRpcError) as delete:
        await managed.stub.DeleteModel(llm_pb2.DeleteModelRequest(model="m"), metadata=MEMBER)
    assert delete.value.code() == grpc.StatusCode.PERMISSION_DENIED
    assert managed.managed.pulled == managed.managed.deleted == []
    models = await managed.stub.ListModels(llm_pb2.ListModelsRequest(), metadata=MEMBER)
    assert [m.id for m in models.models] == ["fake-chat", "fake-embed"]


async def test_a_call_without_a_user_is_denied(managed: Server) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await _pull(managed.stub, metadata=())
    assert err.value.code() == grpc.StatusCode.PERMISSION_DENIED


async def test_nobody_is_admin_while_iam_is_down() -> None:
    async def down(user: str) -> Principal:
        raise ConnectionError("iam unavailable")

    provider = ManagedProvider()
    async for stub in _serve(Providers(provider, provider), down):
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await _pull(stub)
        assert err.value.code() == grpc.StatusCode.PERMISSION_DENIED
        # Everything else works without iam.
        await stub.ListModels(llm_pb2.ListModelsRequest(), metadata=ADMIN)


async def test_unsupported_providers_return_unimplemented(
    unmanaged: llm_pb2_grpc.LlmServiceStub,
) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as pull:
        await _pull(unmanaged)
    assert pull.value.code() == grpc.StatusCode.UNIMPLEMENTED
    with pytest.raises(grpc.aio.AioRpcError) as delete:
        await unmanaged.DeleteModel(llm_pb2.DeleteModelRequest(model="m"), metadata=ADMIN)
    assert delete.value.code() == grpc.StatusCode.UNIMPLEMENTED


async def test_anthropic_cannot_pull_or_delete() -> None:
    provider = AnthropicProvider("key", "claude-sonnet-5-5", 100)
    with pytest.raises(NotSupportedError):
        _ = [step async for step in provider.pull_model("claude-sonnet-5-5")]
    with pytest.raises(NotSupportedError):
        await provider.delete_model("claude-sonnet-5-5")
    await provider.aclose()


async def test_the_request_names_a_model_and_a_configured_provider(managed: Server) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as no_model:
        await _pull(managed.stub, model="")
    assert no_model.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    with pytest.raises(grpc.aio.AioRpcError) as other:
        await _pull(managed.stub, provider="openai")
    assert other.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert len(await _pull(managed.stub, provider="managed")) == 3


async def test_the_embedding_provider_is_addressed_by_name() -> None:
    chat, embedding = FakeProvider(16), ManagedProvider()
    async for stub in _serve(Providers(chat, embedding)):
        assert len(await _pull(stub, provider="managed")) == 3
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await _pull(stub)  # the chat provider is the unmanaged fake
        assert err.value.code() == grpc.StatusCode.UNIMPLEMENTED


async def test_callers_are_resolved_through_iam() -> None:
    seen: list[iam_pb2.ResolveCallerRequest] = []

    class Iam:
        async def ResolveCaller(
            self, request: iam_pb2.ResolveCallerRequest
        ) -> iam_pb2.ResolveCallerResponse:
            seen.append(request)
            return iam_pb2.ResolveCallerResponse(
                user_id="ann",
                platform_admin=True,
                teams=[iam_pb2.CallerTeam(team_id="t1", role=iam_pb2.TEAM_ROLE_ADMIN)],
            )

    principal = await resolver(Iam())("ann")  # type: ignore[arg-type]
    assert principal.platform_admin
    assert principal.is_team_admin("t1")
    assert len(seen) == 1


def _ollama(handler: httpx.MockTransport) -> OllamaProvider:
    return OllamaProvider(
        "http://ollama", "chat", "embed", OllamaLimits(retry_delay=0), transport=handler
    )


def _ndjson(*events: dict[str, object]) -> bytes:
    return b"".join(json.dumps(e).encode() + b"\n" for e in events)


async def test_ollama_streams_the_pull_progress() -> None:
    bodies: list[dict[str, object]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        assert (request.method, request.url.path) == ("POST", "/api/pull")
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            content=_ndjson(
                {"status": "pulling manifest"},
                {"status": "pulling abc", "digest": "abc", "total": 100, "completed": 40},
                {"status": "success"},
            ),
        )

    provider = _ollama(httpx.MockTransport(handle))
    steps = [s async for s in provider.pull_model("llama3.2")]
    assert bodies == [{"model": "llama3.2", "stream": True}]
    assert steps == [
        PullProgress("pulling manifest"),
        PullProgress("pulling abc", completed=40, total=100),
        PullProgress("success", done=True),
    ]
    await provider.aclose()


async def test_ollama_reports_an_unknown_model_when_pulling() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=_ndjson({"error": "pull model manifest: file does not exist"})
        )

    provider = _ollama(httpx.MockTransport(handle))
    with pytest.raises(ModelNotFoundError):
        _ = [s async for s in provider.pull_model("nope")]
    await provider.aclose()


async def test_ollama_pull_that_ends_without_success_fails() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_ndjson({"status": "pulling manifest"}))

    provider = _ollama(httpx.MockTransport(handle))
    with pytest.raises(Exception, match="without a result"):
        _ = [s async for s in provider.pull_model("m")]
    await provider.aclose()


async def test_ollama_deletes_a_model() -> None:
    calls: list[tuple[str, str, bytes]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.content))
        if json.loads(request.content)["model"] == "missing":
            return httpx.Response(404)
        return httpx.Response(200)

    provider = _ollama(httpx.MockTransport(handle))
    await provider.delete_model("llama3.2")
    assert calls == [("DELETE", "/api/delete", b'{"model":"llama3.2"}')]
    with pytest.raises(ModelNotFoundError):
        await provider.delete_model("missing")
    await provider.aclose()
