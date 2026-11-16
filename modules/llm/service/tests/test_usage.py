from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import grpc
import pytest
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc
from knowcel_llm.config import Settings
from knowcel_llm.providers import build_providers
from knowcel_llm.server import LlmServicer
from knowcel_llm.usage import UsageRecord, UsageSum
from knowcel_platform.grpc import USER_HEADER, Principal, PrincipalResolver, UserInterceptor
from sqlalchemy.exc import OperationalError

ADMIN = ((USER_HEADER, "root"),)
MIA = ((USER_HEADER, "mia"),)
HELLO = llm_pb2.GenerateRequest(
    messages=[llm_pb2.Message(role=llm_pb2.ROLE_USER, content="hello")], caller_module="chat"
)


@dataclass
class MemoryStore:
    records: list[UsageRecord] = field(default_factory=list)
    sums: list[UsageSum] = field(default_factory=list)
    asked: list[tuple[int, str | None]] = field(default_factory=list)
    error: Exception | None = None

    async def record(self, record: UsageRecord) -> None:
        if self.error:
            raise self.error
        self.records.append(record)

    async def summarize(self, days: int, user_id: str | None) -> list[UsageSum]:
        if self.error:
            raise self.error
        self.asked.append((days, user_id))
        return self.sums


async def _principal(user: str) -> Principal:
    return Principal(user, platform_admin=user == "root")


async def _serve(store: MemoryStore | None) -> AsyncIterator[llm_pb2_grpc.LlmServiceStub]:
    settings = Settings(llm_provider="fake", embedding_dimensions=16)
    server = grpc.aio.server(interceptors=[UserInterceptor(PrincipalResolver(_principal))])
    llm_pb2_grpc.add_LlmServiceServicer_to_server(
        LlmServicer(build_providers(settings), settings, store), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        yield llm_pb2_grpc.LlmServiceStub(channel)
    await server.stop(None)


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
async def stub(store: MemoryStore) -> AsyncIterator[llm_pb2_grpc.LlmServiceStub]:
    async for s in _serve(store):
        yield s


async def test_a_generation_is_recorded_with_caller_and_user(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    responses = [r async for r in stub.Generate(HELLO, metadata=MIA)]

    (record,) = store.records
    assert (record.user_id, record.caller_module, record.provider) == ("mia", "chat", "fake")
    assert record.model == responses[-1].model
    assert record.output_tokens == responses[-1].usage.output_tokens > 0
    assert record.input_tokens == responses[-1].usage.input_tokens
    assert record.latency_ms >= 0


async def test_a_call_without_user_or_caller_is_recorded_as_unknown(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    request = llm_pb2.GenerateRequest(messages=HELLO.messages)
    _ = [r async for r in stub.Generate(request)]

    (record,) = store.records
    assert (record.user_id, record.caller_module) == ("", "unknown")


async def test_a_recording_failure_does_not_break_generation(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    store.error = OperationalError("insert", {}, ConnectionError("database down"))

    responses = [r async for r in stub.Generate(HELLO, metadata=MIA)]

    assert responses[-1].done
    assert store.records == []


async def test_generation_works_without_a_store() -> None:
    async for stub in _serve(None):
        responses = [r async for r in stub.Generate(HELLO)]
        assert responses[-1].done


SUMS = [UsageSum("2026-11-16", "fake", "fake-chat", "chat", 2, 30, 40)]


async def test_a_user_sees_only_their_usage(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    store.sums = SUMS

    usage = await stub.GetUsage(llm_pb2.GetUsageRequest(), metadata=MIA)

    assert store.asked == [(30, "mia")]
    (entry,) = usage.entries
    assert (entry.date, entry.provider, entry.model, entry.caller_module) == (
        "2026-11-16",
        "fake",
        "fake-chat",
        "chat",
    )
    assert (entry.requests, entry.input_tokens, entry.output_tokens) == (2, 30, 40)


async def test_a_platform_admin_sees_everyones_usage(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    await stub.GetUsage(llm_pb2.GetUsageRequest(days=7), metadata=ADMIN)

    assert store.asked == [(7, None)]


@pytest.mark.parametrize("days", [-1, 367])
async def test_usage_days_are_bounded(stub: llm_pb2_grpc.LlmServiceStub, days: int) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetUsage(llm_pb2.GetUsageRequest(days=days), metadata=MIA)
    assert err.value.code() == grpc.StatusCode.INVALID_ARGUMENT


async def test_usage_needs_a_user(stub: llm_pb2_grpc.LlmServiceStub) -> None:
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetUsage(llm_pb2.GetUsageRequest())
    assert err.value.code() == grpc.StatusCode.UNAUTHENTICATED


async def test_usage_is_unavailable_when_the_database_is(
    stub: llm_pb2_grpc.LlmServiceStub, store: MemoryStore
) -> None:
    store.error = OperationalError("select", {}, ConnectionError("database down"))
    with pytest.raises(grpc.aio.AioRpcError) as err:
        await stub.GetUsage(llm_pb2.GetUsageRequest(), metadata=MIA)
    assert err.value.code() == grpc.StatusCode.UNAVAILABLE


async def test_usage_is_unavailable_without_a_store() -> None:
    async for stub in _serve(None):
        with pytest.raises(grpc.aio.AioRpcError) as err:
            await stub.GetUsage(llm_pb2.GetUsageRequest(), metadata=MIA)
        assert err.value.code() == grpc.StatusCode.UNAVAILABLE
