import asyncio
import logging
import pathlib
from collections.abc import Sequence
from typing import Any

import grpc
import pytest
from google.protobuf.message import Message
from kb.document.v1 import document_pb2
from kb.ingestion.v1 import events_pb2, ingestion_pb2
from kb.llm.v1 import llm_pb2
from kb_ingestion_worker.config import Settings
from kb_ingestion_worker.worker import (
    SUBJECT_FAILED,
    SUBJECT_PROCESSED,
    SUBJECT_PROGRESS,
    SUBJECT_STARTED,
    PeerGate,
    Processor,
    consume,
    deliver,
    is_transient,
)


class FakeDocuments:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.statuses: list[int] = []
        self.chunks: list[document_pb2.ChunkInput] = []

    async def _stream(self):
        yield document_pb2.ReadContentResponse(data=self.content)

    def ReadContent(self, request: document_pb2.ReadContentRequest):
        return self._stream()

    async def SetDocumentStatus(self, request: document_pb2.SetDocumentStatusRequest):
        self.statuses.append(request.status)
        return document_pb2.SetDocumentStatusResponse()

    async def AddChunks(self, request: document_pb2.AddChunksRequest):
        self.chunks = list(request.chunks)
        return document_pb2.AddChunksResponse(chunk_count=len(request.chunks))


class FakeLlm:
    def __init__(self, failures: Sequence[BaseException] = ()) -> None:
        self.failures = list(failures)

    async def Embed(self, request: llm_pb2.EmbedRequest):
        if self.failures:
            raise self.failures.pop(0)
        return llm_pb2.EmbedResponse(
            embeddings=[llm_pb2.Embedding(values=[float(len(t))]) for t in request.inputs]
        )


def make(content: bytes, llm: FakeLlm | None = None, **settings: Any):
    """The processor, its documents and the events it published apart from
    progress reports."""
    published: list[tuple[str, Message]] = []

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        if subject != SUBJECT_PROGRESS:
            published.append((subject, message))

    docs = FakeDocuments(content)
    proc = Processor(Settings(**settings), docs, llm or FakeLlm(), publish)  # type: ignore[arg-type]
    return proc, docs, published


def rpc_error(code: grpc.StatusCode, details: str = "peer detail") -> grpc.aio.AioRpcError:
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), details)


class FakeMsg:
    def __init__(self, event: events_pb2.DocumentUploaded, num_delivered: int) -> None:
        self.data = event.SerializeToString()
        self.headers: dict[str, str] | None = None
        self.num_delivered = num_delivered
        self.acked = False
        self.nak_delay: float | None = None
        self.in_progress_calls = 0

    async def ack(self) -> None:
        self.acked = True

    async def nak(self, delay: float | None = None) -> None:
        self.nak_delay = delay

    async def in_progress(self) -> None:
        self.in_progress_calls += 1


def uploaded(filename: str, content_type: str = "text/markdown") -> events_pb2.DocumentUploaded:
    return events_pb2.DocumentUploaded(
        job_id="j1", document_id="d1", filename=filename, content_type=content_type
    )


def test_chunk_overlap_must_be_below_chunk_size() -> None:
    with pytest.raises(ValueError, match="KB_CHUNK_OVERLAP_TOKENS"):
        Settings(chunk_tokens=100, chunk_overlap_tokens=100)


def test_chunks_must_fit_the_embedding_model_input() -> None:
    # 2 of the 512 go to the [CLS] and [SEP] tokens.
    make(b"", chunk_tokens=510, embedding_max_tokens=512)
    with pytest.raises(ValueError, match="exceeds the embedding model's input limit of 510"):
        make(b"", chunk_tokens=511, embedding_max_tokens=512)


def test_an_unknown_tokenizer_is_rejected() -> None:
    with pytest.raises(ValueError, match="no tokenizer 'nope'"):
        make(b"", chunk_tokenizer="nope")


async def test_processes_text_into_embedded_chunks() -> None:
    proc, docs, published = make(
        b"# Title\n\n" + b"word " * 100,
        chunk_tokens=40,
        chunk_overlap_tokens=5,
        embed_batch_size=2,
    )
    await proc.handle(uploaded("notes.md"))

    assert [s for s, _ in published] == [SUBJECT_STARTED, SUBJECT_PROCESSED]
    event = published[-1][1]
    assert isinstance(event, events_pb2.DocumentProcessed)
    assert event.chunk_count == len(docs.chunks) > 1
    assert [c.index for c in docs.chunks] == list(range(len(docs.chunks)))
    assert all(c.embedding for c in docs.chunks)
    assert docs.statuses == [document_pb2.DOCUMENT_STATUS_PROCESSING]


async def test_events_carry_the_run_and_a_message_id_per_run() -> None:
    sent: list[tuple[str, Message, str]] = []

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        sent.append((subject, message, dedupe_id))

    docs = FakeDocuments(b"# Title\n\nsome text")
    proc = Processor(Settings(), docs, FakeLlm(), publish)  # type: ignore[arg-type]
    first = uploaded("notes.md")
    await proc.handle(first)
    first_chunks = list(docs.chunks)
    second = uploaded("notes.md")
    second.run = 2
    await proc.handle(second)

    assert [(m.run, i) for s, m, i in sent if s != SUBJECT_PROGRESS] == [  # type: ignore[attr-defined]
        (1, "j1:1:started"),
        (1, "j1:1:processed"),
        (2, "j1:2:started"),
        (2, "j1:2:processed"),
    ]
    # AddChunks replaces the document's chunks, so a second run doesn't add to them.
    assert docs.chunks == first_chunks


async def test_markdown_chunks_store_their_heading() -> None:
    proc, docs, _ = make(b"# Title\n\n## Part\n\nSome text.")
    await proc.handle(uploaded("notes.md"))

    assert [c.text for c in docs.chunks] == ["Title > Part\n\nSome text."]
    assert [dict(c.metadata) for c in docs.chunks] == [{"heading": "Title > Part"}]


async def test_pdf_chunks_store_their_page() -> None:
    pdf = (pathlib.Path(__file__).parent / "fixtures" / "pages.pdf").read_bytes()
    proc, docs, _ = make(pdf)
    await proc.handle(uploaded("pages.pdf", "application/pdf"))

    assert [dict(c.metadata) for c in docs.chunks] == [{"page": "1"}, {"page": "3"}]


async def test_unsupported_content_marks_failure() -> None:
    proc, docs, published = make(b"\x00\x01")
    await proc.handle(uploaded("image.png", "image/png"))

    assert [s for s, _ in published] == [SUBJECT_STARTED, SUBJECT_FAILED]
    event = published[-1][1]
    assert isinstance(event, events_pb2.ProcessingFailed)
    assert "unsupported" in event.error
    assert docs.statuses[-1] == document_pb2.DOCUMENT_STATUS_FAILED


async def test_peer_gate_follows_peer_health(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    states = iter([True, False, False, True])

    async def check() -> bool:
        return next(states)

    gate = PeerGate(check)
    assert [await gate.is_open() for _ in range(4)] == [True, False, False, True]
    messages = [r.getMessage() for r in caplog.records]
    assert sum("pausing" in m for m in messages) == 1
    assert sum("resuming" in m for m in messages) == 1


@pytest.mark.parametrize(
    ("exc", "transient"),
    [
        (rpc_error(grpc.StatusCode.UNAVAILABLE), True),
        (rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED), True),
        (rpc_error(grpc.StatusCode.RESOURCE_EXHAUSTED), True),
        (TimeoutError(), True),
        (ConnectionResetError(), True),
        (
            rpc_error(
                grpc.StatusCode.RESOURCE_EXHAUSTED,
                "grpc: received message larger than max (15390798 vs. 4194304)",
            ),
            False,
        ),
        (rpc_error(grpc.StatusCode.INVALID_ARGUMENT), False),
        (rpc_error(grpc.StatusCode.INTERNAL), False),
        (ValueError("document contains no text"), False),
        (RuntimeError("bug"), False),
    ],
)
def test_error_classification(exc: BaseException, transient: bool) -> None:
    assert is_transient(exc) is transient


async def test_a_transient_error_is_retried_with_backoff() -> None:
    llm = FakeLlm([rpc_error(grpc.StatusCode.UNAVAILABLE)] * 3)
    proc, docs, published = make(b"text", llm, retry_delay=2, retry_max_delay=5)
    event = uploaded("notes.md")

    delays = [await proc.handle(event, attempt, last=False) for attempt in (1, 2, 3)]

    assert delays == [2, 4, 5]
    assert SUBJECT_FAILED not in [s for s, _ in published]
    assert document_pb2.DOCUMENT_STATUS_FAILED not in docs.statuses


async def test_processing_succeeds_once_the_peer_is_back() -> None:
    llm = FakeLlm([rpc_error(grpc.StatusCode.UNAVAILABLE)])
    proc, docs, published = make(b"text", llm)
    event = uploaded("notes.md")

    assert await proc.handle(event, 1, last=False) is not None
    assert await proc.handle(event, 2, last=False) is None

    assert [s for s, _ in published][-1] == SUBJECT_PROCESSED
    assert docs.chunks


async def test_the_last_attempt_fails_the_document_with_the_reason() -> None:
    llm = FakeLlm([rpc_error(grpc.StatusCode.UNAVAILABLE)])
    proc, docs, published = make(b"text", llm)

    assert await proc.handle(uploaded("notes.md"), 5, last=True) is None

    event = published[-1][1]
    assert isinstance(event, events_pb2.ProcessingFailed)
    assert event.error == "gave up after 5 attempts: UNAVAILABLE: peer detail"
    assert docs.statuses[-1] == document_pb2.DOCUMENT_STATUS_FAILED


async def test_permanent_errors_fail_at_once_without_retries() -> None:
    proc, docs, published = make(b"\x00\x01")
    assert await proc.handle(uploaded("image.png", "image/png"), 1, last=False) is None
    assert [s for s, _ in published] == [SUBJECT_STARTED, SUBJECT_FAILED]
    assert docs.statuses[-1] == document_pb2.DOCUMENT_STATUS_FAILED


async def test_deliver_naks_a_retry_and_acks_otherwise() -> None:
    llm = FakeLlm([rpc_error(grpc.StatusCode.UNAVAILABLE)])
    proc, _, _ = make(b"text", llm, retry_delay=3)
    event = uploaded("notes.md")

    first = FakeMsg(event, num_delivered=1)
    await deliver(proc, first, max_deliver=5)
    assert (first.acked, first.nak_delay) == (False, 3)

    second = FakeMsg(event, num_delivered=2)
    await deliver(proc, second, max_deliver=5)
    assert (second.acked, second.nak_delay) == (True, None)


async def test_deliver_treats_the_consumer_limit_as_the_last_attempt() -> None:
    llm = FakeLlm([rpc_error(grpc.StatusCode.UNAVAILABLE)])
    proc, _, published = make(b"text", llm)
    msg = FakeMsg(uploaded("notes.md"), num_delivered=3)

    await deliver(proc, msg, max_deliver=3)

    assert msg.acked
    assert [s for s, _ in published][-1] == SUBJECT_FAILED


async def test_reports_progress_per_stage_and_embedding_batch() -> None:
    sent: list[tuple[str, Message, str]] = []

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        sent.append((subject, message, dedupe_id))

    docs = FakeDocuments(b"# Title\n\n" + b"word " * 200)
    settings = Settings(chunk_tokens=40, chunk_overlap_tokens=5, embed_batch_size=2)
    proc = Processor(settings, docs, FakeLlm(), publish)  # type: ignore[arg-type]
    event = uploaded("notes.md")
    event.run = 2
    await proc.handle(event)

    reports = [m for s, m, _ in sent if s == SUBJECT_PROGRESS]
    assert all(isinstance(m, events_pb2.ProcessingProgress) for m in reports)
    steps = [(m.stage, m.progress) for m in reports]  # type: ignore[attr-defined]
    batches = -(-len(docs.chunks) // 2)
    embedding = [p for stage, p in steps if stage == ingestion_pb2.JOB_STAGE_EMBEDDING]
    assert steps[:2] == [
        (ingestion_pb2.JOB_STAGE_EXTRACTING, 0),
        (ingestion_pb2.JOB_STAGE_CHUNKING, 5),
    ]
    # One report as embedding starts, one after every batch.
    assert len(embedding) == batches + 1
    assert embedding[0] == 10
    assert embedding[-1] == 90
    assert steps[-1] == (ingestion_pb2.JOB_STAGE_STORING, 90)
    # Stage and progress only grow, which is what the service relies on.
    assert steps == sorted(steps)
    assert all(m.run == 2 and m.job_id == "j1" for m in reports)  # type: ignore[attr-defined]
    ids = [i for s, _, i in sent if s == SUBJECT_PROGRESS]
    assert ids[0] == "j1:2:progress:1:0"
    # Every report comes before the result.
    assert [s for s, _, _ in sent][-1] == SUBJECT_PROCESSED


async def test_a_failed_progress_report_does_not_fail_the_job() -> None:
    sent: list[str] = []

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        if subject == SUBJECT_PROGRESS:
            raise ConnectionError("nats down")
        sent.append(subject)

    proc = Processor(Settings(), FakeDocuments(b"some text"), FakeLlm(), publish)  # type: ignore[arg-type]
    assert await proc.handle(uploaded("notes.md")) is None
    assert sent == [SUBJECT_STARTED, SUBJECT_PROCESSED]


class SlowLlm(FakeLlm):
    def __init__(self, delay: float) -> None:
        super().__init__()
        self.delay = delay

    async def Embed(self, request: llm_pb2.EmbedRequest):
        await asyncio.sleep(self.delay)
        return await super().Embed(request)


async def test_deliver_keeps_a_long_job_from_being_redelivered() -> None:
    proc, _, _ = make(b"text", SlowLlm(0.1))
    msg = FakeMsg(uploaded("notes.md"), num_delivered=1)

    await deliver(proc, msg, max_deliver=5, heartbeat=0.02)

    assert msg.acked
    assert msg.in_progress_calls >= 2
    calls = msg.in_progress_calls
    await asyncio.sleep(0.05)
    assert msg.in_progress_calls == calls, "heartbeat kept running after the ack"


class Inbox:
    """A stand-in for the JetStream consumer: hands out queued messages."""

    def __init__(self, count: int) -> None:
        self.queue = list(range(count))
        self.requested: list[int] = []

    async def fetch(self, n: int) -> list[int]:
        self.requested.append(n)
        await asyncio.sleep(0)
        taken, self.queue = self.queue[:n], self.queue[n:]
        return taken


async def always() -> bool:
    return True


@pytest.mark.parametrize("concurrency", [1, 3])
async def test_consume_handles_up_to_concurrency_messages_at_once(concurrency: int) -> None:
    inbox, stop = Inbox(7), asyncio.Event()
    running, peak, handled = 0, 0, []

    async def handle(msg: int) -> None:
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        handled.append(msg)
        if len(handled) == 7:
            stop.set()

    await asyncio.wait_for(consume(inbox.fetch, handle, concurrency, stop, always), 5)

    assert sorted(handled) == list(range(7))
    assert peak == concurrency
    # Only free slots are fetched, so no message waits for a slot.
    assert max(inbox.requested) == concurrency


async def test_consume_finishes_running_messages_when_stopped() -> None:
    inbox, stop = Inbox(5), asyncio.Event()
    started, finished = asyncio.Event(), []

    async def handle(msg: int) -> None:
        started.set()
        await asyncio.sleep(0.02)
        finished.append(msg)

    task = asyncio.create_task(consume(inbox.fetch, handle, 2, stop, always))
    await started.wait()
    stop.set()
    await asyncio.wait_for(task, 5)

    assert sorted(finished) == [0, 1]
    assert inbox.queue == [2, 3, 4]


async def test_consume_fetches_nothing_while_peers_are_down() -> None:
    inbox, stop = Inbox(1), asyncio.Event()
    checks = 0

    async def ready() -> bool:
        nonlocal checks
        checks += 1
        if checks == 3:
            stop.set()
        return False

    async def handle(msg: int) -> None:
        raise AssertionError("nothing should be handled")

    await asyncio.wait_for(consume(inbox.fetch, handle, 2, stop, ready, idle=0.01), 5)
    assert inbox.requested == []


async def test_consume_survives_a_failing_handler(caplog: pytest.LogCaptureFixture) -> None:
    inbox, stop = Inbox(3), asyncio.Event()
    handled: list[int] = []

    async def handle(msg: int) -> None:
        handled.append(msg)
        if len(handled) == 3:
            stop.set()
        if msg == 0:
            raise RuntimeError("bug")

    await asyncio.wait_for(consume(inbox.fetch, handle, 1, stop, always), 5)
    assert handled == [0, 1, 2]
    assert any("handling a delivery failed" in r.getMessage() for r in caplog.records)


def test_concurrency_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    assert Settings().worker_concurrency == 2
    monkeypatch.setenv("KB_WORKER_CONCURRENCY", "4")
    assert Settings().worker_concurrency == 4
    monkeypatch.setenv("KB_WORKER_CONCURRENCY", "0")
    with pytest.raises(ValueError, match="worker_concurrency"):
        Settings()
