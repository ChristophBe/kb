import logging
from collections.abc import Awaitable, Callable

from google.protobuf.message import Message
from kb.document.v1 import document_pb2, document_pb2_grpc
from kb.ingestion.v1 import events_pb2
from kb.llm.v1 import llm_pb2, llm_pb2_grpc

from .chunking import chunk_text
from .config import Settings
from .extract import extract_text

log = logging.getLogger(__name__)

STREAM = "INGESTION"
SUBJECT_UPLOADED = "kb.ingestion.uploaded"
SUBJECT_STARTED = "kb.ingestion.started"
SUBJECT_PROCESSED = "kb.ingestion.processed"
SUBJECT_FAILED = "kb.ingestion.failed"

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
        text = extract_text(bytes(data), event.filename, event.content_type)
        chunks = chunk_text(text, self._settings.chunk_size, self._settings.chunk_overlap)
        if not chunks:
            raise ValueError("document contains no text")

        inputs: list[document_pb2.ChunkInput] = []
        batch = self._settings.embed_batch_size
        for start in range(0, len(chunks), batch):
            texts = chunks[start : start + batch]
            resp = await self._llm.Embed(llm_pb2.EmbedRequest(inputs=texts))
            for offset, (text_, emb) in enumerate(zip(texts, resp.embeddings, strict=True)):
                inputs.append(
                    document_pb2.ChunkInput(index=start + offset, text=text_, embedding=emb.values)
                )
        resp = await self._documents.AddChunks(
            document_pb2.AddChunksRequest(document_id=event.document_id, chunks=inputs)
        )
        return resp.chunk_count

    async def _set_status(self, doc_id: str, status: int, detail: str = "") -> None:
        await self._documents.SetDocumentStatus(
            document_pb2.SetDocumentStatusRequest(id=doc_id, status=status, status_detail=detail)  # type: ignore[arg-type]
        )
