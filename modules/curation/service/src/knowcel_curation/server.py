"""kb curation module: gRPC transport."""

import logging
import uuid
from collections.abc import Collection
from typing import Any

import grpc
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_platform.grpc import abort_invalid_argument, current_user, violation
from sqlalchemy.exc import SQLAlchemyError

from .curation import CurationStore, Documents, PeerError, PeerUnavailableError, Score

log = logging.getLogger("knowcel_curation")

_Context = grpc.aio.ServicerContext[Any, Any]

_MAX_SCORE_DOCUMENTS = 100

_KINDS = {
    "duplicate": curation_pb2.FINDING_KIND_DUPLICATE,
    "superseded": curation_pb2.FINDING_KIND_SUPERSEDED,
    "conflict": curation_pb2.FINDING_KIND_CONFLICT,
}


def _score_message(score: Score) -> curation_pb2.DocumentScore:
    message = curation_pb2.DocumentScore(document_id=str(score.document_id), score=score.score)
    message.updated_at.FromDatetime(score.updated_at)
    return message


class CurationServicer(curation_pb2_grpc.CurationServiceServicer):
    def __init__(self, store: CurationStore, documents: Documents) -> None:
        self._store = store
        self._documents = documents

    async def GetDocumentScore(
        self, request: curation_pb2.GetDocumentScoreRequest, context: _Context
    ) -> curation_pb2.GetDocumentScoreResponse:
        await self._require_user(context)
        try:
            document_id = uuid.UUID(request.document_id)
        except ValueError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
        scores = await self._visible_scores(context, {document_id})
        if not scores:
            await context.abort(grpc.StatusCode.NOT_FOUND, "document has no score")
        return curation_pb2.GetDocumentScoreResponse(score=_score_message(scores[0]))

    async def ScoreChunks(
        self, request: curation_pb2.ScoreChunksRequest, context: _Context
    ) -> curation_pb2.ScoreChunksResponse:
        await self._require_user(context)
        if len(request.document_ids) > _MAX_SCORE_DOCUMENTS:
            await abort_invalid_argument(
                context,
                violation(
                    "document_ids",
                    f"At most {_MAX_SCORE_DOCUMENTS} documents can be scored at once",
                ),
            )
        ids: set[uuid.UUID] = set()
        for i, raw in enumerate(request.document_ids):
            try:
                ids.add(uuid.UUID(raw))
            except ValueError:
                await abort_invalid_argument(
                    context, violation(f"document_ids[{i}]", "Document id is not valid")
                )
        scores = await self._visible_scores(context, ids)
        return curation_pb2.ScoreChunksResponse(scores=[_score_message(s) for s in scores])

    async def ListFindings(
        self, request: curation_pb2.ListFindingsRequest, context: _Context
    ) -> curation_pb2.ListFindingsResponse:
        await self._require_user(context)
        try:
            found = await self._store.list_findings()
        except SQLAlchemyError:
            log.exception("listing findings failed")
            await context.abort(grpc.StatusCode.UNAVAILABLE, "the database is not available")
        response = curation_pb2.ListFindingsResponse()
        for f in found:
            message = response.findings.add(
                id=str(f.id),
                kind=_KINDS.get(f.kind, curation_pb2.FINDING_KIND_UNSPECIFIED),
                document_id=str(f.document_id),
                other_document_id=str(f.other_document_id),
            )
            message.created_at.FromDatetime(f.created_at)
        return response

    async def _visible_scores(self, context: _Context, ids: Collection[uuid.UUID]) -> list[Score]:
        """The scores of those of `ids` that have one and that the caller can see."""
        if not ids:
            return []
        try:
            scores = await self._store.get_scores(ids)
            # Only scored documents are looked up in the document module.
            visible = await self._documents.visible({s.document_id for s in scores})
        except SQLAlchemyError:
            log.exception("loading scores failed")
            await context.abort(grpc.StatusCode.UNAVAILABLE, "the database is not available")
        except PeerUnavailableError:
            log.warning("scores withheld: the document module is unavailable")
            await context.abort(grpc.StatusCode.UNAVAILABLE, "documents are unavailable right now")
        except PeerError:
            log.exception("checking which documents the caller can see failed")
            await context.abort(grpc.StatusCode.INTERNAL, "loading scores failed")
        return [s for s in scores if s.document_id in visible]

    @staticmethod
    async def _require_user(context: _Context) -> None:
        if current_user() is None:
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "sign in to see curation results")
