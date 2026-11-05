import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

import grpc
from google.protobuf.message import Message
from kb.document.v1 import document_pb2, document_pb2_grpc
from kb.ingestion.v1 import events_pb2
from kb.llm.v1 import llm_pb2, llm_pb2_grpc

from .chunking import chunk_markdown, chunk_pages
from .config import Settings
from .extract import extract_pages, is_markdown

log = logging.getLogger(__name__)

STREAM = "INGESTION"
SUBJECT_UPLOADED = "kb.ingestion.uploaded"
SUBJECT_STARTED = "kb.ingestion.started"
SUBJECT_PROCESSED = "kb.ingestion.processed"
SUBJECT_FAILED = "kb.ingestion.failed"


class PeerGate:
    """Whether the services the worker needs (document, llm) are serving.

    They are soft dependencies: while one is down the worker stops taking jobs,
    which stay queued in the stream, instead of failing them. Only changes are
    logged, not every check."""

    def __init__(self, check: Callable[[], Awaitable[bool]]) -> None:
        self._check = check
        self._open = True

    async def is_open(self) -> bool:
        ok = await self._check()
        if ok != self._open:
            if ok:
                log.info("document and llm services available; resuming job intake")
            else:
                log.warning("document or llm service unavailable; pausing job intake")
            self._open = ok
        return ok


# publish(subject, message, dedupe_id)
Publish = Callable[[str, Message, str], Awaitable[None]]

# Peer statuses worth waiting for: the peer is down, too slow or overloaded.
_TRANSIENT_CODES = {
    grpc.StatusCode.UNAVAILABLE,
    grpc.StatusCode.DEADLINE_EXCEEDED,
    grpc.StatusCode.RESOURCE_EXHAUSTED,
}


def is_transient(exc: BaseException) -> bool:
    """Whether a later attempt may succeed. Anything unrecognised is permanent,
    so that a bug fails the document instead of being retried over and over."""
    if isinstance(exc, grpc.aio.AioRpcError):
        # gRPC also reports an oversized message as RESOURCE_EXHAUSTED; that never gets better.
        if "larger than max" in (exc.details() or ""):
            return False
        return exc.code() in _TRANSIENT_CODES
    return isinstance(exc, TimeoutError | ConnectionError)


class Processor:
    """Processes one DocumentUploaded event end to end."""

    def __init__(
        self,
        settings: Settings,
        documents: document_pb2_grpc.DocumentServiceStub,
        llm: llm_pb2_grpc.LlmServiceStub,
        publish: Publish,
    ) -> None:
        self._settings = settings
        self._documents = documents
        self._llm = llm
        self._publish = publish

    async def handle(
        self, event: events_pb2.DocumentUploaded, attempt: int = 1, last: bool = True
    ) -> float | None:
        """Processes the upload. Returns the delay before the next attempt when a
        transient error should be retried, or None when the upload is finished,
        successfully or not. On the last attempt every error is final.

        Every event names the job's processing run (0 from older publishers
        means the first), and its message id is unique per run, so that the
        events of a reprocessed job aren't deduplicated away. The document's
        chunks are replaced, not appended to (AddChunks)."""
        job, doc_id, run = event.job_id, event.document_id, event.run or 1
        await self._publish(
            SUBJECT_STARTED,
            events_pb2.ProcessingStarted(job_id=job, document_id=doc_id, run=run),
            f"{job}:{run}:started",
        )
        try:
            await self._set_status(doc_id, document_pb2.DOCUMENT_STATUS_PROCESSING)
            count = await self._process(event)
        except Exception as exc:
            error = _describe(exc)
            if is_transient(exc) and not last:
                delay = self._retry_delay(attempt)
                log.warning(
                    "attempt %d for document %s failed, retrying in %.0fs: %s",
                    attempt,
                    doc_id,
                    delay,
                    error,
                )
                return delay
            log.exception("processing failed for document %s", doc_id)
            if is_transient(exc):
                error = f"gave up after {attempt} attempts: {error}"
            await self._set_status(doc_id, document_pb2.DOCUMENT_STATUS_FAILED, error)
            await self._publish(
                SUBJECT_FAILED,
                events_pb2.ProcessingFailed(job_id=job, document_id=doc_id, error=error, run=run),
                f"{job}:{run}:failed",
            )
            return None
        log.info("processed document %s into %d chunks", doc_id, count)
        await self._publish(
            SUBJECT_PROCESSED,
            events_pb2.DocumentProcessed(
                job_id=job, document_id=doc_id, chunk_count=count, run=run
            ),
            f"{job}:{run}:processed",
        )
        return None

    def _retry_delay(self, attempt: int) -> float:
        delay = self._settings.retry_delay * 2 ** (attempt - 1)
        return min(delay, self._settings.retry_max_delay)

    async def _process(self, event: events_pb2.DocumentUploaded) -> int:
        data = bytearray()
        async for part in self._documents.ReadContent(
            document_pb2.ReadContentRequest(id=event.document_id)
        ):
            data.extend(part.data)
        pages = extract_pages(bytes(data), event.filename, event.content_type)
        size, overlap = self._settings.chunk_size, self._settings.chunk_overlap
        if is_markdown(event.filename, event.content_type):
            min_section = self._settings.chunk_min_section_size
            chunks = chunk_markdown(pages[0].text, size, overlap, min_section)
        else:
            chunks = chunk_pages(pages, size, overlap)
        if not chunks:
            raise ValueError("document contains no text")

        inputs: list[document_pb2.ChunkInput] = []
        batch = self._settings.embed_batch_size
        for start in range(0, len(chunks), batch):
            group = chunks[start : start + batch]
            resp = await self._llm.Embed(llm_pb2.EmbedRequest(inputs=[c.text for c in group]))
            for offset, (chunk, emb) in enumerate(zip(group, resp.embeddings, strict=True)):
                inputs.append(
                    document_pb2.ChunkInput(
                        index=start + offset,
                        text=chunk.text,
                        metadata=chunk.metadata,
                        embedding=emb.values,
                    )
                )
        resp = await self._documents.AddChunks(
            document_pb2.AddChunksRequest(document_id=event.document_id, chunks=inputs)
        )
        return resp.chunk_count

    async def _set_status(self, doc_id: str, status: int, detail: str = "") -> None:
        await self._documents.SetDocumentStatus(
            document_pb2.SetDocumentStatusRequest(id=doc_id, status=status, status_detail=detail)  # type: ignore[arg-type]
        )


def _describe(exc: BaseException) -> str:
    if isinstance(exc, grpc.aio.AioRpcError):
        return f"{exc.code().name}: {exc.details()}"
    return str(exc) or type(exc).__name__


class Delivery(Protocol):
    """The part of a JetStream message the worker uses."""

    data: bytes

    @property
    def num_delivered(self) -> int: ...

    async def ack(self) -> None: ...

    async def nak(self, delay: float | None = None) -> None: ...


async def deliver(processor: Processor, msg: Delivery, max_deliver: int) -> None:
    """Handles one delivery: ack when done, NAK with a delay to retry. The
    consumer redelivers at most max_deliver times, so that delivery is the last."""
    event = events_pb2.DocumentUploaded.FromString(msg.data)
    attempt = msg.num_delivered
    retry_in = await processor.handle(event, attempt, last=attempt >= max_deliver)
    if retry_in is None:
        await msg.ack()
    else:
        await msg.nak(delay=retry_in)
