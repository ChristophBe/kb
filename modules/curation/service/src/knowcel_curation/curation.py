"""The scores and findings the curation module keeps, and how documents are
scored; db.py implements the store, peers.py the document port."""

import asyncio
import contextlib
import datetime
import logging
import uuid
from collections.abc import Awaitable, Callable, Collection, Sequence
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("knowcel_curation")

DUPLICATE = "duplicate"
SUPERSEDED = "superseded"
CONFLICT = "conflict"
REVIEW_DUE = "review_due"
REPORTED = "reported"

# Lifecycle states.
DRAFT = "draft"
IN_REVIEW = "in_review"
APPROVED = "approved"
DEPRECATED = "deprecated"
ARCHIVED = "archived"
STATES = (DRAFT, IN_REVIEW, APPROVED, DEPRECATED, ARCHIVED)
# States whose documents consumers leave out of answers.
EXCLUDED = (DEPRECATED, ARCHIVED)

# Resolutions of a finding.
KEEP = "keep"
REPLACE = "replace"
IGNORE = "ignore"
DEPRECATE = "deprecate"
RESOLUTIONS = (KEEP, REPLACE, IGNORE, DEPRECATE)

# Ratings of a document or passage.
HELPFUL = "helpful"
NOT_HELPFUL = "not_helpful"
RATINGS = (HELPFUL, NOT_HELPFUL)

# Reasons for reporting a document.
WRONG = "wrong"
OUTDATED = "outdated"
INAPPROPRIATE = "inappropriate"
OTHER = "other"
REASONS = (WRONG, OUTDATED, INAPPROPRIATE, OTHER)


class PeerError(Exception):
    """A peer module failed in a way retrying won't fix."""


class PeerUnavailableError(PeerError):
    """A peer module can't be reached right now."""


@dataclass(frozen=True)
class Score:
    document_id: uuid.UUID
    score: float
    # When ingestion last finished the document: the recency of the score.
    processed_at: datetime.datetime
    updated_at: datetime.datetime


@dataclass(frozen=True)
class Finding:
    id: uuid.UUID
    # duplicate, superseded or conflict
    kind: str
    document_id: uuid.UUID
    other_document_id: uuid.UUID
    created_at: datetime.datetime
    # keep, replace or ignore; None while the finding is open.
    resolution: str | None = None


@dataclass(frozen=True)
class Report:
    """One user's open report of a document."""

    document_id: uuid.UUID
    reporter: str
    reason: str
    comment: str
    created_at: datetime.datetime


@dataclass(frozen=True)
class Lifecycle:
    state: str
    # The user responsible for the review.
    owner: str
    review_by: datetime.datetime | None = None


@dataclass(frozen=True)
class LifecycleChange:
    lifecycle: Lifecycle
    note: str
    changed_by: str
    changed_at: datetime.datetime


@dataclass(frozen=True)
class FindingCursor:
    """Where a page of findings ends: the next one is older, or as old with a greater id."""

    created_at: datetime.datetime
    id: uuid.UUID


@dataclass(frozen=True)
class DocInfo:
    """What the curation module reads of a document, from the document module."""

    id: uuid.UUID
    title: str
    filename: str
    sha256: str
    created_at: datetime.datetime
    owner_id: str = ""
    # The teams the document is shared with, as far as the caller sees them.
    team_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Weights:
    """How the signals add up to a score (see score_document)."""

    recency: float
    usage: float
    # Days after which the recency has halved.
    half_life_days: float
    # Factor applied once per replacement, between 0 and 1.
    replacement_penalty: float
    # Citations at which the usage signal is at its maximum.
    usage_saturation: int
    # What the lifecycle state does to a score: approved documents are scored
    # up (never above 1), deprecated and archived ones down.
    approved_boost: float = 1.0
    deprecated_factor: float = 1.0
    archived_factor: float = 1.0
    # What open reports do to a score: it is multiplied by `report_penalty` for
    # each user who reported the document, but not below `report_floor`.
    report_penalty: float = 1.0
    report_floor: float = 0.0
    # Weight of how helpful users found the document, next to the other signals,
    # once it has at least `rating_min` ratings; 0 leaves ratings out.
    rating: float = 0.0
    rating_min: int = 1


def score_document(
    processed_at: datetime.datetime,
    now: datetime.datetime,
    replacements: int,
    citations: int,
    weights: Weights,
    state: str | None = None,
    reports: int = 0,
    ratings: tuple[int, int] = (0, 0),
) -> float:
    """A score between 0 and 1: the weighted mean of recency (1 when just
    processed, halving every `half_life_days`) and usage (citations up to
    `usage_saturation`), times `replacement_penalty` once per replacement and
    `report_penalty` once per reporting user (not below `report_floor`), then
    raised for an approved document and lowered for a deprecated or archived one.
    `ratings` are the numbers of helpful and unhelpful ratings: from
    `rating_min` of them on, the share found helpful is a signal of its own."""
    age_days = max((now - processed_at).total_seconds(), 0) / 86400
    recency = 0.5 ** (age_days / weights.half_life_days)
    usage = min(citations / weights.usage_saturation, 1)
    helpful, unhelpful = ratings
    rated = weights.rating > 0 and helpful + unhelpful >= max(weights.rating_min, 1)
    rating_weight = weights.rating if rated else 0
    share = helpful / (helpful + unhelpful) if rated else 0
    signals = (weights.recency * recency + weights.usage * usage + rating_weight * share) / (
        weights.recency + weights.usage + rating_weight
    )
    score = signals * weights.replacement_penalty**replacements
    score *= max(weights.report_floor, weights.report_penalty**reports)
    if state == APPROVED:
        return min(score * weights.approved_boost, 1)
    if state == DEPRECATED:
        return score * weights.deprecated_factor
    if state == ARCHIVED:
        return score * weights.archived_factor
    return score


class CurationStore(Protocol):
    async def get_scores(self, document_ids: Collection[uuid.UUID]) -> list[Score]: ...

    async def save_score(
        self, document_id: uuid.UUID, processed_at: datetime.datetime, score: float
    ) -> None: ...

    async def count_replacements(self, document_id: uuid.UUID) -> int: ...

    async def list_scores(self, after: uuid.UUID | None, limit: int) -> list[Score]:
        """Up to `limit` scores ordered by document id, after the one given."""
        ...

    async def add_finding(
        self, kind: str, document_id: uuid.UUID, other_document_id: uuid.UUID
    ) -> bool:
        """Records a finding; False when the pair already has one of that kind."""
        ...

    async def get_finding(self, finding_id: uuid.UUID) -> Finding | None: ...

    async def resolve_finding(self, finding_id: uuid.UUID, resolution: str, user: str) -> bool:
        """Closes an open finding, and the reports of a REPORTED one in the same
        change; False when it doesn't exist or is closed already."""
        ...

    async def list_open_findings(
        self,
        limit: int,
        after: FindingCursor | None = None,
        kinds: Collection[str] = (),
    ) -> list[Finding]:
        """Up to `limit` open findings, newest first, after the cursor; only of
        the kinds given, when any."""
        ...

    async def get_replacements(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, set[uuid.UUID]]:
        """For each of the documents that are replaced, the documents replacing
        it: those of a version found and not dismissed, and of a confirmed
        replacement."""
        ...

    async def get_lifecycles(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, Lifecycle]:
        """The current lifecycle of those of the documents that have one."""
        ...

    async def save_rating(
        self,
        document_id: uuid.UUID,
        user: str,
        chunk_index: int | None,
        rating: str,
        conversation_id: str,
    ) -> None:
        """Records the user's rating of the document or passage, replacing their earlier one."""
        ...

    async def delete_rating(
        self, document_id: uuid.UUID, user: str, chunk_index: int | None
    ) -> None:
        """Takes the user's rating of the document or passage back."""
        ...

    async def get_rating(
        self, document_id: uuid.UUID, user: str, chunk_index: int | None
    ) -> str | None: ...

    async def rating_counts(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[int, int]]:
        """For each document with ratings, how many users found it helpful and how
        many not, each by their latest rating of the document or of a passage of it."""
        ...

    async def save_report(
        self, document_id: uuid.UUID, reporter: str, reason: str, comment: str
    ) -> None:
        """Records the user's report, replacing their earlier one (also a closed one)."""
        ...

    async def list_reports(
        self, document_ids: Collection[uuid.UUID]
    ) -> dict[uuid.UUID, list[Report]]:
        """The open reports of those of the documents that have any, oldest first."""
        ...

    async def close_report_finding(self, document_id: uuid.UUID, user: str) -> None:
        """Resolves the document's open REPORTED finding as deprecated and closes
        its reports, as one change; nothing when it has none."""
        ...

    async def delete_resolved_finding(self, kind: str, document_id: uuid.UUID) -> None:
        """Removes the document's finding of that kind when it is resolved, so a
        new one can be made."""
        ...

    async def add_lifecycle_change(
        self, document_id: uuid.UUID, lifecycle: Lifecycle, note: str, user: str
    ) -> None: ...

    async def list_lifecycle_history(self, document_id: uuid.UUID) -> list[LifecycleChange]:
        """Every change, newest first."""
        ...

    async def list_review_due(self, now: datetime.datetime, limit: int) -> list[uuid.UUID]:
        """Documents whose current lifecycle is not archived and has a review
        date before `now`, and that have no review-due finding yet."""
        ...

    async def delete_review_due(self, document_id: uuid.UUID) -> None:
        """Removes the document's REVIEW_DUE finding, open or closed."""
        ...


class Documents(Protocol):
    async def readable(self, document_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, DocInfo]:
        """Those of the documents the current caller can read. Raises PeerUnavailableError."""
        ...


class Scorer:
    def __init__(self, store: CurationStore, weights: Weights) -> None:
        self._store = store
        self._weights = weights

    async def on_processed(self, document_id: uuid.UUID, processed_at: datetime.datetime) -> None:
        """Scores a document ingestion has finished (again). A newer event for
        the same document keeps its newest time, so redeliveries are harmless."""
        current = await self._current(document_id)
        if current and current.processed_at > processed_at:
            processed_at = current.processed_at
        await self._save(document_id, processed_at)

    async def rescore(
        self, document_id: uuid.UUID, unscored_since: datetime.datetime | None = None
    ) -> None:
        """Scores a document again after its replacements or lifecycle changed.
        A document that was never processed has no score to update, unless
        `unscored_since` says from when to score it (its creation): consumers
        must still learn that it is deprecated."""
        current = await self._current(document_id)
        if current:
            await self._save(document_id, current.processed_at)
        elif unscored_since is not None:
            await self._save(document_id, unscored_since)

    async def rescore_all(self, batch: int = 200) -> None:
        """Scores every document again: recency decays with time, so stored
        scores go stale without it."""
        after = None
        while scores := await self._store.list_scores(after, batch):
            ids = {s.document_id for s in scores}
            lifecycles = await self._store.get_lifecycles(ids)
            reports = {i: len(r) for i, r in (await self._store.list_reports(ids)).items()}
            ratings = await self._store.rating_counts(ids)
            for score in scores:
                await self._save(
                    score.document_id, score.processed_at, lifecycles, reports, ratings
                )
            after = scores[-1].document_id

    async def _current(self, document_id: uuid.UUID) -> Score | None:
        scores = await self._store.get_scores([document_id])
        return scores[0] if scores else None

    async def _save(
        self,
        document_id: uuid.UUID,
        processed_at: datetime.datetime,
        lifecycles: dict[uuid.UUID, Lifecycle] | None = None,
        reports: dict[uuid.UUID, int] | None = None,
        ratings: dict[uuid.UUID, tuple[int, int]] | None = None,
    ) -> None:
        replacements = await self._store.count_replacements(document_id)
        if lifecycles is None:
            lifecycles = await self._store.get_lifecycles([document_id])
        if reports is None:
            reports = {
                i: len(r) for i, r in (await self._store.list_reports([document_id])).items()
            }
        # The usage signal needs chat to report its citations; until it does,
        # usage is 0 (and weighs nothing unless KNOWCEL_CURATION_USAGE_WEIGHT is set).
        if ratings is None:
            ratings = await self._store.rating_counts([document_id])
        lifecycle = lifecycles.get(document_id)
        score = score_document(
            processed_at,
            datetime.datetime.now(datetime.UTC),
            replacements,
            0,
            self._weights,
            lifecycle.state if lifecycle else None,
            reports.get(document_id, 0),
            ratings.get(document_id, (0, 0)),
        )
        await self._store.save_score(document_id, processed_at, score)
        log.info("scored document %s: %.3f (%d replacements)", document_id, score, replacements)


async def run_periodically(
    jobs: Sequence[Callable[[], Awaitable[None]]], interval: float, stop: asyncio.Event
) -> None:
    """Runs the jobs every `interval` seconds until `stop` is set; a job that
    fails is logged and tried again next time, and doesn't hold back the others."""
    while not stop.is_set():
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), interval)
            return
        for job in jobs:
            try:
                await job()
            except Exception:
                log.exception("a periodic job failed, retrying in %.0f s", interval)
