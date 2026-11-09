import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Protocol

import grpc
from google.protobuf.message import Message
from kb.document.v1 import document_pb2, document_pb2_grpc
from kb.ingestion.v1 import events_pb2, ingestion_pb2
from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_platform.nats import receive
from prometheus_client import Counter, Gauge, Histogram

from .chunking import chunk_markdown, chunk_pages
from .config import Settings
from .extract import extract_pages, is_markdown
from .tokens import load as load_tokenizer

log = logging.getLogger(__name__)

STREAM = "INGESTION"
SUBJECT_UPLOADED = "kb.ingestion.uploaded"
SUBJECT_STARTED = "kb.ingestion.started"
SUBJECT_PROGRESS = "kb.ingestion.progress"
SUBJECT_PROCESSED = "kb.ingestion.processed"
SUBJECT_FAILED = "kb.ingestion.failed"

# Metrics (docs/metrics.md). An attempt ends processed, failed (for good) or
# retried (a transient error; the upload is delivered again later).
JOBS = Counter(
    "kb_ingestion_worker_jobs",
    "Processing attempts of uploads, by outcome: processed, failed or retried.",
    ["outcome"],
)
JOB_SECONDS = Histogram(
    "kb_ingestion_worker_job_duration_seconds",
    "Time one processing attempt took (download, extract, chunk, embed, store), by outcome.",
    ["outcome"],
    buckets=(0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800, 3600),
)
JOBS_IN_PROGRESS = Gauge(
    "kb_ingestion_worker_jobs_in_progress", "Uploads this worker is processing right now."
)
CHUNKS = Counter("kb_ingestion_worker_chunks", "Chunks stored for processed uploads.")


def _observe(outcome: str, start: float) -> None:
    JOBS.labels(outcome).inc()
    JOB_SECONDS.labels(outcome).observe(time.perf_counter() - start)


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


# Progress (0 to 100) at the start of each stage. Embedding takes most of the
# time, so it covers 10 to 90 and advances after every batch.
_EXTRACTING = ingestion_pb2.JOB_STAGE_EXTRACTING
_CHUNKING = ingestion_pb2.JOB_STAGE_CHUNKING
_EMBEDDING = ingestion_pb2.JOB_STAGE_EMBEDDING
_STORING = ingestion_pb2.JOB_STAGE_STORING
_EMBEDDING_START, _EMBEDDING_END = 10, 90


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
        self._tokens = load_tokenizer(settings.chunk_tokenizer)
        # The longest input the worker may send to the embedding model.
        self._max_tokens = settings.embedding_max_tokens - self._tokens.special_tokens
        if settings.chunk_tokens > self._max_tokens:
            raise ValueError(
                f"KB_CHUNK_TOKENS ({settings.chunk_tokens}) exceeds the embedding model's "
                f"input limit of {self._max_tokens} tokens (KB_EMBEDDING_MAX_TOKENS "
                f"{settings.embedding_max_tokens} minus "
                f"{self._tokens.special_tokens} special tokens)"
            )
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
        start = time.perf_counter()
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
                _observe("retried", start)
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
            _observe("failed", start)
            return None
        log.info("processed document %s into %d chunks", doc_id, count)
        await self._publish(
            SUBJECT_PROCESSED,
            events_pb2.DocumentProcessed(
                job_id=job, document_id=doc_id, chunk_count=count, run=run
            ),
            f"{job}:{run}:processed",
        )
        _observe("processed", start)
        CHUNKS.inc(count)
        return None

    def _retry_delay(self, attempt: int) -> float:
        delay = self._settings.retry_delay * 2 ** (attempt - 1)
        return min(delay, self._settings.retry_max_delay)

    async def _report(self, event: events_pb2.DocumentUploaded, stage: int, progress: int) -> None:
        """Publishes how far the job got. Best effort: progress is only shown
        to the user, so a failed publish doesn't fail the job."""
        run = event.run or 1
        message = events_pb2.ProcessingProgress(
            job_id=event.job_id,
            document_id=event.document_id,
            run=run,
            stage=stage,  # type: ignore[arg-type]
            progress=progress,
        )
        try:
            await self._publish(
                SUBJECT_PROGRESS, message, f"{event.job_id}:{run}:progress:{stage}:{progress}"
            )
        except Exception as exc:
            log.warning("could not report progress of job %s: %s", event.job_id, exc)

    async def _process(self, event: events_pb2.DocumentUploaded) -> int:
        await self._report(event, _EXTRACTING, 0)
        data = bytearray()
        async for part in self._documents.ReadContent(
            document_pb2.ReadContentRequest(id=event.document_id)
        ):
            data.extend(part.data)
        # Extraction and chunking are CPU-bound; a thread keeps the other jobs
        # and the delivery heartbeats going meanwhile.
        pages = await asyncio.to_thread(
            extract_pages, bytes(data), event.filename, event.content_type
        )
        await self._report(event, _CHUNKING, 5)
        size, overlap = self._settings.chunk_tokens, self._settings.chunk_overlap_tokens
        if is_markdown(event.filename, event.content_type):
            min_section = self._settings.chunk_min_section_tokens
            chunks = await asyncio.to_thread(
                chunk_markdown, pages[0].text, size, overlap, min_section, self._tokens
            )
        else:
            chunks = await asyncio.to_thread(chunk_pages, pages, size, overlap, self._tokens)
        if not chunks:
            raise ValueError("document contains no text")
        # Chunking stays within size; only a run of characters that can't be cut
        # (one grapheme of thousands of tokens) could exceed it. Fail rather than
        # let the model truncate it.
        for chunk in chunks:
            if (count := self._tokens.count(chunk.text)) > self._max_tokens:
                raise ValueError(
                    f"a chunk has {count} tokens, more than the embedding model's "
                    f"limit of {self._max_tokens}"
                )

        await self._report(event, _EMBEDDING, _EMBEDDING_START)
        inputs: list[document_pb2.ChunkInput] = []
        batch = self._settings.embed_batch_size
        span = _EMBEDDING_END - _EMBEDDING_START
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
            done = start + len(group)
            await self._report(event, _EMBEDDING, _EMBEDDING_START + span * done // len(chunks))
        await self._report(event, _STORING, _EMBEDDING_END)
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
    # Carry the publisher's trace context, if any (kb_platform.nats).
    headers: dict[str, str] | None

    @property
    def num_delivered(self) -> int: ...

    async def ack(self) -> None: ...

    async def nak(self, delay: float | None = None) -> None: ...

    async def in_progress(self) -> None: ...


async def deliver(
    processor: Processor, msg: Delivery, max_deliver: int, heartbeat: float | None = None
) -> None:
    """Handles one delivery: ack when done, NAK with a delay to retry. The
    consumer redelivers at most max_deliver times, so that delivery is the last.

    Every heartbeat seconds while the upload is processed the delivery is
    marked in progress, so that JetStream doesn't redeliver a long job to
    another worker once the consumer's ack wait has passed. With tracing on the
    upload is processed within the trace of the request that published it."""
    event = events_pb2.DocumentUploaded.FromString(msg.data)
    attempt = msg.num_delivered
    beat = asyncio.create_task(_keep_alive(msg, heartbeat)) if heartbeat else None
    try:
        with receive(SUBJECT_UPLOADED, msg.headers), JOBS_IN_PROGRESS.track_inprogress():
            retry_in = await processor.handle(event, attempt, last=attempt >= max_deliver)
    finally:
        if beat:
            beat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await beat
    if retry_in is None:
        await msg.ack()
    else:
        await msg.nak(delay=retry_in)


async def _keep_alive(msg: Delivery, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await msg.in_progress()
        except Exception as exc:
            log.warning("could not extend the ack wait of a delivery: %s", exc)


async def consume[T](
    fetch: Callable[[int], Awaitable[list[T]]],
    handle: Callable[[T], Awaitable[None]],
    concurrency: int,
    stop: asyncio.Event,
    ready: Callable[[], Awaitable[bool]],
    idle: float = 2,
) -> None:
    """Handles up to concurrency messages at once until stop is set, then waits
    for the ones in progress.

    fetch(n) returns up to n messages, or none after a while. Messages are only
    fetched for free slots, so none waits in the worker while its ack wait runs
    out. While ready() is false (a peer is down) no new messages are fetched;
    it is checked again after idle seconds."""
    running: set[asyncio.Task[None]] = set()

    async def guarded(msg: T) -> None:
        try:
            await handle(msg)
        except Exception:
            # Not acked: JetStream redelivers it after the ack wait.
            log.exception("handling a delivery failed")

    stopped = asyncio.create_task(stop.wait())
    try:
        while not stop.is_set():
            if len(running) >= concurrency:
                await asyncio.wait({stopped, *running}, return_when=asyncio.FIRST_COMPLETED)
                continue
            if not await ready():
                await asyncio.wait({stopped}, timeout=idle)
                continue
            for msg in await fetch(concurrency - len(running)):
                task = asyncio.create_task(guarded(msg))
                running.add(task)
                task.add_done_callback(running.discard)
        if running:
            await asyncio.wait(running)
    finally:
        stopped.cancel()
