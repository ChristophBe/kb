import logging

import pytest
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
)


class FakeDocuments:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.statuses: list[int] = []
        self.chunks: list[document_pb2.ChunkInput] = []

    async def _stream(self):
        yield document_pb2.ReadContentResponse(data=self.content)

    def ReadContent(self, request):
        return self._stream()

    async def SetDocumentStatus(self, request):
        self.statuses.append(request.status)
        return document_pb2.SetDocumentStatusResponse()

    async def AddChunks(self, request):
        self.chunks = list(request.chunks)
        return document_pb2.AddChunksResponse(chunk_count=len(request.chunks))


class FakeLlm:
    async def Embed(self, request):
        return llm_pb2.EmbedResponse(
            embeddings=[llm_pb2.Embedding(values=[float(len(t))]) for t in request.inputs]
        )


def make(content: bytes, **settings):
    published: list[tuple[str, object]] = []

    async def publish(subject, message, dedupe_id):
        published.append((subject, message))

    docs = FakeDocuments(content)
    proc = Processor(Settings(**settings), docs, FakeLlm(), publish)  # type: ignore[arg-type]
    return proc, docs, published


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
    assert published[-1][1].chunk_count == len(docs.chunks) > 1
    assert [c.index for c in docs.chunks] == list(range(len(docs.chunks)))
    assert all(c.embedding for c in docs.chunks)
    assert docs.statuses == [document_pb2.DOCUMENT_STATUS_PROCESSING]


async def test_unsupported_content_marks_failure() -> None:
    proc, docs, published = make(b"\x00\x01")
    await proc.handle(uploaded("image.png", "image/png"))

    assert [s for s, _ in published] == [SUBJECT_STARTED, SUBJECT_FAILED]
    assert "unsupported" in published[-1][1].error
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
