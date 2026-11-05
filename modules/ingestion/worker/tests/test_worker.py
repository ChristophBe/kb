import logging
import pathlib
from collections.abc import Sequence
from typing import Any

import grpc
import pytest
from google.protobuf.message import Message
from kb.document.v1 import document_pb2
from kb.ingestion.v1 import events_pb2
from kb.llm.v1 import llm_pb2
from kb_ingestion_worker.config import Settings
from kb_ingestion_worker.worker import (
    SUBJECT_FAILED,
    SUBJECT_PROCESSED,
    SUBJECT_STARTED,
    PeerGate,
    Processor,
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
    published: list[tuple[str, Message]] = []

    async def publish(subject: str, message: Message, dedupe_id: str) -> None:
        published.append((subject, message))

    docs = FakeDocuments(content)
    proc = Processor(Settings(**settings), docs, llm or FakeLlm(), publish)  # type: ignore[arg-type]
    return proc, docs, published


def rpc_error(code: grpc.StatusCode, details: str = "peer detail") -> grpc.aio.AioRpcError:
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), details)


class FakeMsg:
    def __init__(self, event: events_pb2.DocumentUploaded, num_delivered: int) -> None:
        self.data = event.SerializeToString()
        self.num_delivered = num_delivered
        self.acked = False
        self.nak_delay: float | None = None

    async def ack(self) -> None:
        self.acked = True

    async def nak(self, delay: float | None = None) -> None:
        self.nak_delay = delay


def uploaded(filename: str, content_type: str = "text/markdown") -> events_pb2.DocumentUploaded:
    return events_pb2.DocumentUploaded(
        job_id="j1", document_id="d1", filename=filename, content_type=content_type
    )


async def test_processes_text_into_embedded_chunks() -> None:
    proc, docs, published = make(
        b"# Title\n\n" + b"word " * 100, chunk_size=200, chunk_overlap=20, embed_batch_size=2
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

    assert [(m.run, i) for _, m, i in sent] == [  # type: ignore[attr-defined]
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
