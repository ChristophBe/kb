"""The scores and findings the curation module keeps, and how documents are
scored; db.py implements the store, peers.py the document port."""

import asyncio
import contextlib
import datetime
import logging
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("knowcel_curation")

DUPLICATE = "duplicate"
SUPERSEDED = "superseded"
CONFLICT = "conflict"

# Resolutions of a finding.
KEEP = "keep"
REPLACE = "replace"
IGNORE = "ignore"
RESOLUTIONS = (KEEP, REPLACE, IGNORE)


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
class DocInfo:
    """What the curation module reads of a document, from the document module."""

    id: uuid.UUID
    title: str
    filename: str
    sha256: str
    created_at: datetime.datetime


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


def score_document(
    processed_at: datetime.datetime,
    now: datetime.datetime,
    replacements: int,
    citations: int,
    weights: Weights,
) -> float:
    """A score between 0 and 1: the weighted mean of recency (1 when just
    processed, halving every `half_life_days`) and usage (citations up to
    `usage_saturation`), times `replacement_penalty` once per replacement."""
    age_days = max((now - processed_at).total_seconds(), 0) / 86400
    recency = 0.5 ** (age_days / weights.half_life_days)
    usage = min(citations / weights.usage_saturation, 1)
    signals = (weights.recency * recency + weights.usage * usage) / (
        weights.recency + weights.usage
    )
    return signals * weights.replacement_penalty**replacements


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
        """Closes an open finding; False when it doesn't exist or is closed already."""
        ...

    async def list_open_findings(self, limit: int) -> list[Finding]:
        """The newest open findings."""
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

    async def rescore(self, document_id: uuid.UUID) -> None:
        """Scores a document again after its replacements changed; documents
        that were never processed have no score to update."""
        current = await self._current(document_id)
        if current:
            await self._save(document_id, current.processed_at)

    async def rescore_all(self, batch: int = 200) -> None:
        """Scores every document again: recency decays with time, so stored
        scores go stale without it."""
        after = None
        while scores := await self._store.list_scores(after, batch):
            for score in scores:
                await self._save(score.document_id, score.processed_at)
            after = scores[-1].document_id

    async def _current(self, document_id: uuid.UUID) -> Score | None:
        scores = await self._store.get_scores([document_id])
        return scores[0] if scores else None

    async def _save(self, document_id: uuid.UUID, processed_at: datetime.datetime) -> None:
        replacements = await self._store.count_replacements(document_id)
        # The usage signal needs chat to report its citations; until it does,
        # usage is 0 (and weighs nothing unless KNOWCEL_CURATION_USAGE_WEIGHT is set).
        score = score_document(
            processed_at, datetime.datetime.now(datetime.UTC), replacements, 0, self._weights
        )
        await self._store.save_score(document_id, processed_at, score)
        log.info("scored document %s: %.3f (%d replacements)", document_id, score, replacements)


async def rescore_periodically(scorer: Scorer, interval: float, stop: asyncio.Event) -> None:
    """Scores every document again every `interval` seconds until `stop` is set."""
    while not stop.is_set():
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), interval)
            return
        try:
            await scorer.rescore_all()
        except Exception:
            log.exception("scoring all documents again failed, retrying in %.0f s", interval)
