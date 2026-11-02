import logging
from collections.abc import Awaitable, Callable

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

    async def handle(self, event: events_pb2.DocumentUploaded) -> None:
        job, doc_id = event.job_id, event.document_id
        await self._publish(
            SUBJECT_STARTED,
            events_pb2.ProcessingStarted(job_id=job, document_id=doc_id),
            f"{job}:started",
        )
        try:
            await self._set_status(doc_id, document_pb2.DOCUMENT_STATUS_PROCESSING)
            count = await self._process(event)
        except Exception as exc:
            log.exception("processing failed for document %s", doc_id)
            error = str(exc) or type(exc).__name__
            await self._set_status(doc_id, document_pb2.DOCUMENT_STATUS_FAILED, error)
            await self._publish(
                SUBJECT_FAILED,
                events_pb2.ProcessingFailed(job_id=job, document_id=doc_id, error=error),
                f"{job}:failed",
            )
            return
        log.info("processed document %s into %d chunks", doc_id, count)
        await self._publish(
            SUBJECT_PROCESSED,
            events_pb2.DocumentProcessed(job_id=job, document_id=doc_id, chunk_count=count),
            f"{job}:processed",
        )

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
