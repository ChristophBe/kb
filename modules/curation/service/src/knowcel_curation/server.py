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
    Principal,
    abort_invalid_argument,
    current_principal,
    current_user,
    violation,
)
from sqlalchemy.exc import SQLAlchemyError

from .curation import (
    APPROVED,
    ARCHIVED,
    DEPRECATE,
    DEPRECATED,
    DRAFT,
    EXCLUDED,
    HELPFUL,
    IGNORE,
    IN_REVIEW,
    INAPPROPRIATE,
    KEEP,
    NOT_HELPFUL,
    OTHER,
    OUTDATED,
    REPLACE,
    REPORTED,
    REVIEW_DUE,
    WRONG,
    CurationStore,
    DocInfo,
    Documents,
    Finding,
    FindingCursor,
    Lifecycle,
    LifecycleChange,
    PeerError,
    PeerUnavailableError,
    Report,
    Score,
    Scorer,
)
from .findings import resolution_options, summary
from .lifecycle import LifecycleService, may_change
from .ratings import RatingService
from .reports import ReportService, sees_all_reports, visible_reports

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
    curation_pb2.RESOLUTION_DEPRECATE: DEPRECATE,
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
_REASONS = {
    curation_pb2.REPORT_REASON_WRONG: WRONG,
    curation_pb2.REPORT_REASON_OUTDATED: OUTDATED,
    curation_pb2.REPORT_REASON_INAPPROPRIATE: INAPPROPRIATE,
    curation_pb2.REPORT_REASON_OTHER: OTHER,
}
_REASON_ENUMS = {name: value for value, name in _REASONS.items()}
_RATINGS = {
    curation_pb2.RATING_HELPFUL: HELPFUL,
    curation_pb2.RATING_NOT_HELPFUL: NOT_HELPFUL,
}
_RATING_ENUMS = {name: value for value, name in _RATINGS.items()}
_MAX_CONVERSATION_ID = 100
# Passages of a document are far fewer; this only keeps absurd values out.
_MAX_CHUNK_INDEX = 1_000_000
_MAX_NOTE = 1000
_MAX_OWNER = 200

_KIND_NAMES = {
    curation_pb2.FINDING_KIND_DUPLICATE: "duplicate",
    curation_pb2.FINDING_KIND_SUPERSEDED: "superseded",
    curation_pb2.FINDING_KIND_CONFLICT: "conflict",
    curation_pb2.FINDING_KIND_REVIEW_DUE: "review_due",
    curation_pb2.FINDING_KIND_REPORTED: "reported",
}

_KINDS = {
    "review_due": curation_pb2.FINDING_KIND_REVIEW_DUE,
    "reported": curation_pb2.FINDING_KIND_REPORTED,
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
        reports: ReportService,
        ratings: RatingService,
    ) -> None:
        self._store = store
        self._documents = documents
        self._scorer = scorer
        self._lifecycle = lifecycle
        self._reports = reports
        self._ratings = ratings

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
        user = await self._require_user(context)
        principal = current_principal()
        wanted = min(request.page_size or _DEFAULT_FINDINGS, _MAX_FINDINGS)
        try:
            after = _decode_cursor(request.page_token)
        except ValueError:
            await abort_invalid_argument(
                context, violation("page_token", "Page token is not valid")
            )
        kinds = [k for kind, k in _KIND_NAMES.items() if kind in request.kinds]
        response = curation_pb2.ListFindingsResponse()
        async with self._failures(context, "listing findings"):
            scanned = 0
            more = True
            while more and len(response.findings) < wanted and scanned < _MAX_SCAN:
                batch = await self._store.list_open_findings(_SCAN_BATCH, after, kinds)
                more = len(batch) == _SCAN_BATCH
                scanned += len(batch)
                documents = await self._documents.readable(
                    {i for f in batch for i in (f.document_id, f.other_document_id)}
                )
                reported_ids = {f.document_id for f in batch if f.kind == REPORTED}
                reported = await self._store.list_reports(reported_ids) if reported_ids else {}
                for f in batch:
                    if len(response.findings) == wanted:
                        more = True
                        break
                    after = FindingCursor(f.created_at, f.id)
                    if f.document_id in documents and f.other_document_id in documents:
                        message = _present(f, documents, reported, user, principal)
                        if message:
                            response.findings.append(message)
            if more and after is not None:
                response.next_page_token = _encode_cursor(after)
        return response

    async def ReportDocument(
        self, request: curation_pb2.ReportDocumentRequest, context: _Context
    ) -> curation_pb2.ReportDocumentResponse:
        user = await self._require_user(context)
        reason = _REASONS.get(request.reason)
        violations = []
        if reason is None:
            violations.append(violation("reason", "Choose a reason"))
        comment = request.comment.strip()
        if len(comment) > _MAX_NOTE:
            violations.append(
                violation("comment", f"Comment must be at most {_MAX_NOTE} characters")
            )
        if reason is None or violations:
            await abort_invalid_argument(context, *violations)
        document_id = await self._document_id(context, request.document_id)
        async with self._failures(context, "reporting a document"):
            if document_id not in await self._documents.readable({document_id}):
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            await self._reports.report(document_id, user, reason, comment)
        return curation_pb2.ReportDocumentResponse()

    async def ListReports(
        self, request: curation_pb2.ListReportsRequest, context: _Context
    ) -> curation_pb2.ListReportsResponse:
        user = await self._require_user(context)
        document_id = await self._document_id(context, request.document_id)
        async with self._failures(context, "listing reports"):
            document = (await self._documents.readable({document_id})).get(document_id)
            if document is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            found = (await self._store.list_reports({document_id})).get(document_id, [])
        shown = visible_reports(found, document, user, current_principal())
        return curation_pb2.ListReportsResponse(reports=[_report_message(r) for r in shown])

    async def RateDocument(
        self, request: curation_pb2.RateDocumentRequest, context: _Context
    ) -> curation_pb2.RateDocumentResponse:
        user = await self._require_user(context)
        violations = []
        rating = _RATINGS.get(request.rating)
        if rating is None and request.rating != curation_pb2.RATING_NONE:
            violations.append(violation("rating", "Choose helpful or not helpful"))
        chunk_index = request.chunk_index if request.HasField("chunk_index") else None
        if chunk_index is not None and not 0 <= chunk_index < _MAX_CHUNK_INDEX:
            violations.append(violation("chunk_index", "Passage number is not valid"))
        if len(request.conversation_id) > _MAX_CONVERSATION_ID:
            violations.append(violation("conversation_id", "Conversation id is too long"))
        if violations:
            await abort_invalid_argument(context, *violations)
        document_id = await self._document_id(context, request.document_id)
        async with self._failures(context, "rating a document"):
            if document_id not in await self._documents.readable({document_id}):
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            await self._ratings.rate(
                document_id, user, chunk_index, rating, request.conversation_id
            )
        return curation_pb2.RateDocumentResponse()

    async def GetRatingSummary(
        self, request: curation_pb2.GetRatingSummaryRequest, context: _Context
    ) -> curation_pb2.GetRatingSummaryResponse:
        user = await self._require_user(context)
        chunk_index = request.chunk_index if request.HasField("chunk_index") else None
        if chunk_index is not None and not 0 <= chunk_index < _MAX_CHUNK_INDEX:
            await abort_invalid_argument(
                context, violation("chunk_index", "Passage number is not valid")
            )
        document_id = await self._document_id(context, request.document_id)
        async with self._failures(context, "loading the ratings"):
            if document_id not in await self._documents.readable({document_id}):
                await context.abort(grpc.StatusCode.NOT_FOUND, "document not found")
            helpful, unhelpful = (await self._store.rating_counts({document_id})).get(
                document_id, (0, 0)
            )
            mine = await self._store.get_rating(document_id, user, chunk_index)
        return curation_pb2.GetRatingSummaryResponse(
            helpful=helpful,
            not_helpful=unhelpful,
            my_rating=_RATING_ENUMS.get(mine, curation_pb2.RATING_NONE)
            if mine
            else curation_pb2.RATING_NONE,
        )

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
                document_id,
                Lifecycle(state, owner, review_by),
                request.note,
                user,
                document.created_at,
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
            readable = await self._documents.readable(ids)
            if len(readable) < len(ids):
                await context.abort(grpc.StatusCode.NOT_FOUND, "finding not found")
            document = readable[finding.document_id]
            if finding.resolution is not None:
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION, "the finding is already resolved"
                )
            if finding.kind == REPORTED:
                await self._check_report_resolution(context, document, resolution, user)
            elif resolution == DEPRECATE:
                await abort_invalid_argument(
                    context, violation("resolution", "Deprecate only applies to reports")
                )
            # The finding is claimed first (a report finding takes its reports with it), so
            # of two who resolve it at once, one acts.
            if not await self._store.resolve_finding(finding_id, resolution, user):
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION, "the finding is already resolved"
                )
            if finding.kind == REPORTED and resolution == DEPRECATE:
                current = (await self._store.get_lifecycles([finding.document_id])).get(
                    finding.document_id
                )
                await self._lifecycle.set(
                    finding.document_id,
                    Lifecycle(
                        DEPRECATED,
                        current.owner if current else document.owner_id or user,
                        current.review_by if current else None,
                    ),
                    "Deprecated after reports",
                    user,
                    document.created_at,
                )
        try:
            await self._scorer.rescore(finding.document_id)
        except SQLAlchemyError:
            # The resolution is saved; the next periodic rescore applies it.
            log.exception("scoring document %s again failed", finding.document_id)
        return curation_pb2.ResolveFindingResponse()

    async def _check_report_resolution(
        self, context: _Context, document: DocInfo, resolution: str, user: str
    ) -> None:
        """What closing a report finding needs: a choice that fits it, and the
        right to change the document's lifecycle."""
        if resolution not in (IGNORE, DEPRECATE):
            await abort_invalid_argument(
                context, violation("resolution", "Choose dismiss or deprecate for reports")
            )
        principal = current_principal()
        if not may_change(document, user, principal):
            if principal is not None and principal.unavailable:
                await context.abort(grpc.StatusCode.UNAVAILABLE, "teams are unavailable right now")
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                "only the owner, a team admin or a platform admin can close reports",
            )

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
            # Two documents that replace each other are both kept.
            onward = await self._store.get_replacements(replacer_ids) if replacer_ids else {}
        return [
            (
                s,
                lifecycles.get(s.document_id),
                any(
                    r in replacers and s.document_id not in onward.get(r, ())
                    for r in replacements.get(s.document_id, ())
                ),
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


def _report_message(report: Report) -> curation_pb2.Report:
    message = curation_pb2.Report(
        reporter=report.reporter,
        reason=_REASON_ENUMS[report.reason],
        comment=report.comment,
    )
    message.created_at.FromDatetime(report.created_at)
    return message


def _present(
    finding: Finding,
    documents: dict[uuid.UUID, DocInfo],
    reported: dict[uuid.UUID, list[Report]],
    user: str,
    principal: Principal | None,
) -> curation_pb2.Finding | None:
    """The finding as the caller sees it; None when it isn't for them."""
    document, other = documents[finding.document_id], documents[finding.other_document_id]
    if finding.kind != REPORTED:
        return _finding_message(finding, document, other)
    shown = visible_reports(reported.get(finding.document_id, []), document, user, principal)
    if not shown:
        return None
    return _finding_message(
        finding, document, other, shown, sees_all_reports(document, user, principal)
    )


def _finding_message(
    finding: Finding,
    document: DocInfo,
    other: DocInfo,
    reports: list[Report] | None = None,
    privileged: bool = True,
) -> curation_pb2.Finding:
    message = curation_pb2.Finding(
        id=str(finding.id),
        kind=_KINDS.get(finding.kind, curation_pb2.FINDING_KIND_UNSPECIFIED),
        document_id=str(finding.document_id),
        other_document_id=str(finding.other_document_id),
        summary=summary(finding, other.title, len(reports or ()), privileged),
        document_title=document.title,
        other_document_title=other.title,
        resolutions=[
            curation_pb2.ResolutionOption(
                resolution=_RESOLUTION_ENUMS[resolution], description=description
            )
            for resolution, description in resolution_options(finding, document.title, other.title)
            if privileged
        ],
        reports=[_report_message(r) for r in reports or ()],
        report_count=len(reports or ()),
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
