"""kb curation module: gRPC transport."""

import logging
import uuid
from typing import Any

import grpc
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_platform.grpc import current_user
from sqlalchemy.exc import SQLAlchemyError

from .curation import CurationStore

log = logging.getLogger("knowcel_curation")

_Context = grpc.aio.ServicerContext[Any, Any]

_KINDS = {
    "duplicate": curation_pb2.FINDING_KIND_DUPLICATE,
    "superseded": curation_pb2.FINDING_KIND_SUPERSEDED,
    "conflict": curation_pb2.FINDING_KIND_CONFLICT,
}


class CurationServicer(curation_pb2_grpc.CurationServiceServicer):
    def __init__(self, store: CurationStore) -> None:
        self._store = store

    async def GetDocumentScore(
        self, request: curation_pb2.GetDocumentScoreRequest, context: _Context
    ) -> curation_pb2.GetDocumentScoreResponse:
        await self._require_user(context)
        try:
            document_id = uuid.UUID(request.document_id)
        except ValueError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
        try:
            score = await self._store.get_score(document_id)
        except SQLAlchemyError:
            log.exception("loading the score of a document failed")
            await context.abort(grpc.StatusCode.UNAVAILABLE, "the database is not available")
        if score is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "document has no score")
        message = curation_pb2.DocumentScore(document_id=str(score.document_id), score=score.score)
        message.updated_at.FromDatetime(score.updated_at)
        return curation_pb2.GetDocumentScoreResponse(score=message)

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

    @staticmethod
    async def _require_user(context: _Context) -> None:
        if current_user() is None:
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "sign in to see curation results")
