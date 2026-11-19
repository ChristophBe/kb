"""kb curation module: gRPC transport."""

import base64
import contextlib
import datetime
import logging
import uuid
from collections.abc import AsyncIterator, Collection
from typing import Any

import grpc
from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_platform.grpc import (
    abort_invalid_argument,
    current_principal,
    current_user,
    violation,
)
from sqlalchemy.exc import SQLAlchemyError

from .curation import (
    APPROVED,
    ARCHIVED,
    DEPRECATED,
    DRAFT,
    EXCLUDED,
    IGNORE,
    IN_REVIEW,
    KEEP,
    REPLACE,
    REVIEW_DUE,
    CurationStore,
    DocInfo,
    Documents,
    Finding,
    FindingCursor,
    Lifecycle,
    LifecycleChange,
    PeerError,
    PeerUnavailableError,
    Score,
    Scorer,
)
from .findings import resolution_options, summary
from .lifecycle import LifecycleService, may_change

log = logging.getLogger("knowcel_curation")

_Context = grpc.aio.ServicerContext[Any, Any]

_MAX_SCORE_DOCUMENTS = 100
_DEFAULT_FINDINGS = 50
_MAX_FINDINGS = 100
# Open findings read at a time, and at most per call: many can be about
# documents the caller can't see.
_SCAN_BATCH = 100
_MAX_SCAN = 1000

_RESOLUTIONS = {
    curation_pb2.RESOLUTION_KEEP: KEEP,
    curation_pb2.RESOLUTION_REPLACE: REPLACE,
    curation_pb2.RESOLUTION_IGNORE: IGNORE,
}
_RESOLUTION_ENUMS = {name: value for value, name in _RESOLUTIONS.items()}

_STATES = {
    curation_pb2.LIFECYCLE_STATE_DRAFT: DRAFT,
    curation_pb2.LIFECYCLE_STATE_IN_REVIEW: IN_REVIEW,
    curation_pb2.LIFECYCLE_STATE_APPROVED: APPROVED,
    curation_pb2.LIFECYCLE_STATE_DEPRECATED: DEPRECATED,
    curation_pb2.LIFECYCLE_STATE_ARCHIVED: ARCHIVED,
}
_STATE_ENUMS = {name: value for value, name in _STATES.items()}
_MAX_NOTE = 1000
_MAX_OWNER = 200

_KINDS = {
    "review_due": curation_pb2.FINDING_KIND_REVIEW_DUE,
    "duplicate": curation_pb2.FINDING_KIND_DUPLICATE,
    "superseded": curation_pb2.FINDING_KIND_SUPERSEDED,
    "conflict": curation_pb2.FINDING_KIND_CONFLICT,
}


def _lifecycle_message(lifecycle: Lifecycle) -> curation_pb2.Lifecycle:
    message = curation_pb2.Lifecycle(state=_STATE_ENUMS[lifecycle.state], owner=lifecycle.owner)
    if lifecycle.review_by:
        message.review_by.FromDatetime(lifecycle.review_by)
    return message


def _score_message(
    score: Score, lifecycle: Lifecycle | None, replaced: bool
) -> curation_pb2.DocumentScore:
    message = curation_pb2.DocumentScore(
        document_id=str(score.document_id), score=score.score, replaced=replaced
    )
    message.updated_at.FromDatetime(score.updated_at)
    if lifecycle:
        message.lifecycle.CopyFrom(_lifecycle_message(lifecycle))
        message.excluded = lifecycle.state in EXCLUDED
    return message


def _change_message(change: LifecycleChange) -> curation_pb2.LifecycleChange:
    message = curation_pb2.LifecycleChange(
        lifecycle=_lifecycle_message(change.lifecycle),
        note=change.note,
        changed_by=change.changed_by,
    )
    message.changed_at.FromDatetime(change.changed_at)
    return message


class CurationServicer(curation_pb2_grpc.CurationServiceServicer):
    def __init__(
        self,
        store: CurationStore,
        documents: Documents,
        scorer: Scorer,
        lifecycle: LifecycleService,
    ) -> None:
        self._store = store
        self._documents = documents
        self._scorer = scorer
        self._lifecycle = lifecycle

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
        score, lifecycle, replaced = scores[0]
        return curation_pb2.GetDocumentScoreResponse(
            score=_score_message(score, lifecycle, replaced)
        )

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
        return curation_pb2.ScoreChunksResponse(
            scores=[_score_message(*scored) for scored in scores]
        )

    async def ListFindings(
        self, request: curation_pb2.ListFindingsRequest, context: _Context
    ) -> curation_pb2.ListFindingsResponse:
        await self._require_user(context)
        wanted = min(request.page_size or _DEFAULT_FINDINGS, _MAX_FINDINGS)
        try:
            after = _decode_cursor(request.page_token)
        except ValueError:
            await abort_invalid_argument(
                context, violation("page_token", "Page token is not valid")
            )
        response = curation_pb2.ListFindingsResponse()
        async with self._failures(context, "listing findings"):
            scanned = 0
            more = True
            while more and len(response.findings) < wanted and scanned < _MAX_SCAN:
                batch = await self._store.list_open_findings(_SCAN_BATCH, after)
                more = len(batch) == _SCAN_BATCH
                scanned += len(batch)
                documents = await self._documents.readable(
                    {i for f in batch for i in (f.document_id, f.other_document_id)}
                )
                for f in batch:
                    if len(response.findings) == wanted:
                        more = True
                        break
                    after = FindingCursor(f.created_at, f.id)
                    if f.document_id in documents and f.other_document_id in documents:
                        response.findings.append(
                            _finding_message(
                                f, documents[f.document_id], documents[f.other_document_id]
                            )
                        )
            if more and after is not None:
                response.next_page_token = _encode_cursor(after)
        return response

    async def SetLifecycle(
        self, request: curation_pb2.SetLifecycleRequest, context: _Context
    ) -> curation_pb2.SetLifecycleResponse:
        user = await self._require_user(context)
        violations = []
        state = _STATES.get(request.state)
        if state is None:
            violations.append(violation("state", "Choose a lifecycle state"))
        if len(request.note) > _MAX_NOTE:
            violations.append(violation("note", f"Note must be at most {_MAX_NOTE} characters"))
        if len(request.owner) > _MAX_OWNER:
            violations.append(violation("owner", f"Owner must be at most {_MAX_OWNER} characters"))
        if state is None or violations:
            await abort_invalid_argument(context, *violations)
        document_id = await self._document_id(context, request.document_id)
        review_by = None
        if request.HasField("review_by"):
            try:
                review_by = request.review_by.ToDatetime(tzinfo=datetime.UTC)
            except (ValueError, OverflowError):
                await abort_invalid_argument(
                    context, violation("review_by", "Review date is not a valid date")
                )
        async with self._failures(context, "setting the lifecycle"):
            document = (await self._documents.readable({document_id})).get(document_id)
            if document is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            principal = current_principal()
            if not may_change(document, user, principal):
                if principal is not None and principal.unavailable:
                    await context.abort(
                        grpc.StatusCode.UNAVAILABLE, "teams are unavailable right now"
                    )
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    "only the owner, a team admin or a platform admin can change the lifecycle",
                )
            # Without an owner in the request, the one responsible stays so.
            current = (await self._store.get_lifecycles([document_id])).get(document_id)
            owner = request.owner or (current.owner if current else user)
            await self._lifecycle.set(
                document_id, Lifecycle(state, owner, review_by), request.note, user
            )
        return curation_pb2.SetLifecycleResponse()

    async def ListLifecycleHistory(
        self, request: curation_pb2.ListLifecycleHistoryRequest, context: _Context
    ) -> curation_pb2.ListLifecycleHistoryResponse:
        await self._require_user(context)
        document_id = await self._document_id(context, request.document_id)
        async with self._failures(context, "loading the lifecycle history"):
            if document_id not in await self._documents.readable({document_id}):
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            changes = await self._store.list_lifecycle_history(document_id)
        return curation_pb2.ListLifecycleHistoryResponse(
            changes=[_change_message(c) for c in changes]
        )

    @staticmethod
    async def _document_id(context: _Context, raw: str) -> uuid.UUID:
        try:
            return uuid.UUID(raw)
        except ValueError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")

    async def ResolveFinding(
        self, request: curation_pb2.ResolveFindingRequest, context: _Context
    ) -> curation_pb2.ResolveFindingResponse:
        user = await self._require_user(context)
        resolution = _RESOLUTIONS.get(request.resolution)
        if resolution is None:
            await abort_invalid_argument(
                context, violation("resolution", "Choose keep, replace or ignore")
            )
        try:
            finding_id = uuid.UUID(request.finding_id)
        except ValueError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "finding not found")
        async with self._failures(context, "resolving a finding"):
            finding = await self._store.get_finding(finding_id)
            if finding is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "finding not found")
            if finding.kind == REVIEW_DUE and resolution == REPLACE:
                await abort_invalid_argument(
                    context, violation("resolution", "Replace doesn't apply to a review reminder")
                )
            ids = {finding.document_id, finding.other_document_id}
            if len(await self._documents.readable(ids)) < len(ids):
                await context.abort(grpc.StatusCode.NOT_FOUND, "finding not found")
            if finding.resolution is not None or not await self._store.resolve_finding(
                finding_id, resolution, user
            ):
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION, "the finding is already resolved"
                )
        try:
            await self._scorer.rescore(finding.document_id)
        except SQLAlchemyError:
            # The resolution is saved; the next periodic rescore applies it.
            log.exception("scoring document %s again failed", finding.document_id)
        return curation_pb2.ResolveFindingResponse()

    async def _visible_scores(
        self, context: _Context, ids: Collection[uuid.UUID]
    ) -> list[tuple[Score, Lifecycle | None, bool]]:
        """The scores of those of `ids` that have one and that the caller can
        see, with the lifecycle and whether a document the caller can read
        replaces it."""
        if not ids:
            return []
        async with self._failures(context, "loading scores"):
            scores = await self._store.get_scores(ids)
            # Only scored documents are looked up in the document module.
            visible = await self._documents.readable({s.document_id for s in scores})
            lifecycles = await self._store.get_lifecycles(visible)
            replacements = await self._store.get_replacements(visible)
            # A replacement the caller can't read doesn't count: they'd be left with nothing.
            replacer_ids = set().union(*replacements.values())
            replacers = await self._documents.readable(replacer_ids) if replacer_ids else {}
        return [
            (
                s,
                lifecycles.get(s.document_id),
                bool(replacements.get(s.document_id, set()) & replacers.keys()),
            )
            for s in scores
            if s.document_id in visible
        ]

    @contextlib.asynccontextmanager
    async def _failures(self, context: _Context, what: str) -> AsyncIterator[None]:
        """Ends the call with the status that fits a failure of the database or
        of the document module."""
        try:
            yield
        except SQLAlchemyError:
            log.exception("%s failed", what)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "the database is not available")
        except PeerUnavailableError:
            log.warning("%s failed: the document module is unavailable", what)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "documents are unavailable right now")
        except PeerError:
            log.exception("%s failed", what)
            await context.abort(grpc.StatusCode.INTERNAL, f"{what} failed")

    @staticmethod
    async def _require_user(context: _Context) -> str:
        user = current_user()
        if user is None:
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "sign in to see curation results")
        return user


def _finding_message(finding: Finding, document: DocInfo, other: DocInfo) -> curation_pb2.Finding:
    message = curation_pb2.Finding(
        id=str(finding.id),
        kind=_KINDS.get(finding.kind, curation_pb2.FINDING_KIND_UNSPECIFIED),
        document_id=str(finding.document_id),
        other_document_id=str(finding.other_document_id),
        summary=summary(finding, other.title),
        document_title=document.title,
        other_document_title=other.title,
        resolutions=[
            curation_pb2.ResolutionOption(
                resolution=_RESOLUTION_ENUMS[resolution], description=description
            )
            for resolution, description in resolution_options(finding, document.title, other.title)
        ],
    )
    message.created_at.FromDatetime(finding.created_at)
    return message


def _encode_cursor(cursor: FindingCursor) -> str:
    raw = f"{cursor.created_at.isoformat()}|{cursor.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(token: str) -> FindingCursor | None:
    """Raises ValueError for a token that isn't one of ours."""
    if not token:
        return None
    created_at, _, finding_id = base64.urlsafe_b64decode(token.encode()).decode().partition("|")
    return FindingCursor(datetime.datetime.fromisoformat(created_at), uuid.UUID(finding_id))
