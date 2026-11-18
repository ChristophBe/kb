"""Finding duplicate, superseded and conflicting documents, and how a finding
reads to a person. The ports are implemented by peers.py."""

import logging
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from knowcel_platform.grpc import as_user

from .curation import (
    CONFLICT,
    DUPLICATE,
    IGNORE,
    KEEP,
    REPLACE,
    SUPERSEDED,
    DocInfo,
    Finding,
    Scorer,
)

log = logging.getLogger("knowcel_curation")

# Of the sampled passages of a document, the share that must have a near copy
# in another document for it to be a duplicate, or a version of it.
_DUPLICATE_SHARE = 0.8
_VERSION_SHARE = 0.5
# Passages found per sampled passage.
_HITS = 10
# Characters of a passage given to the model that compares two.
_PASSAGE_CHARS = 2000


@dataclass(frozen=True)
class Hit:
    """A passage of another document that resembles a sampled one."""

    document_id: uuid.UUID
    score: float
    text: str


@dataclass(frozen=True)
class Thresholds:
    # Cosine similarities of passages: at least `duplicate` for a copy, at
    # least `version` for a revised version, at least `conflict` to be worth
    # asking the model whether they contradict each other.
    duplicate: float
    version: float
    conflict: float
    # Passages of a document that are compared with the others.
    sample_chunks: int
    # Pairs of passages per document the model is asked about; 0 turns the
    # check off.
    conflict_checks: int


class Corpus(Protocol):
    """The documents of the user the work is done for."""

    async def get(self, document_id: uuid.UUID) -> DocInfo | None: ...

    async def sample(self, document_id: uuid.UUID, count: int) -> list[str]:
        """The text of up to `count` passages spread over the document."""
        ...

    async def similar(self, embedding: Sequence[float], model: str, limit: int) -> list[Hit]: ...


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> tuple[list[list[float]], str]:
        """The vectors of the texts and the model that made them."""
        ...


class Judge(Protocol):
    async def contradicts(self, first: str, second: str) -> bool: ...


class Detector:
    def __init__(
        self,
        store: "FindingStore",
        corpus: Corpus,
        embedder: Embedder,
        judge: Judge,
        scorer: Scorer,
        thresholds: Thresholds,
    ) -> None:
        self._store = store
        self._corpus = corpus
        self._embedder = embedder
        self._judge = judge
        self._scorer = scorer
        self._thresholds = thresholds

    async def detect(self, document_id: uuid.UUID, owner_id: str) -> None:
        """Looks for documents the owner can read that duplicate, replace or
        contradict the document, and records what it finds."""
        with as_user(owner_id):
            document = await self._corpus.get(document_id)
            if document is None:
                return
            texts = await self._corpus.sample(document_id, self._thresholds.sample_chunks)
            if not texts:
                return
            vectors, model = await self._embedder.embed(texts)
            matches = await self._matches(document_id, texts, vectors, model)
            conflict_checks = self._thresholds.conflict_checks
            for other_id, found in matches.items():
                other = await self._corpus.get(other_id)
                if other is None:
                    continue
                kind = self._classify(document, other, found, len(texts))
                if kind is None and conflict_checks > 0:
                    kind = await self._conflict(found)
                    conflict_checks -= 1
                if kind is not None:
                    await self._record(kind, document, other)

    async def _matches(
        self,
        document_id: uuid.UUID,
        texts: Sequence[str],
        vectors: Sequence[Sequence[float]],
        model: str,
    ) -> dict[uuid.UUID, list[tuple[str, Hit]]]:
        """For each other document, its best passage for each sampled passage
        that resembles one."""
        matches: dict[uuid.UUID, list[tuple[str, Hit]]] = {}
        for text, vector in zip(texts, vectors, strict=True):
            best: dict[uuid.UUID, Hit] = {}
            for hit in await self._corpus.similar(vector, model, _HITS):
                if hit.document_id == document_id or hit.score < self._thresholds.conflict:
                    continue
                if hit.document_id not in best or hit.score > best[hit.document_id].score:
                    best[hit.document_id] = hit
            for other_id, hit in best.items():
                matches.setdefault(other_id, []).append((text, hit))
        return matches

    def _classify(
        self, document: DocInfo, other: DocInfo, found: list[tuple[str, Hit]], sampled: int
    ) -> str | None:
        t = self._thresholds
        copies = sum(1 for _, hit in found if hit.score >= t.duplicate)
        versions = sum(1 for _, hit in found if hit.score >= t.version)
        if (document.sha256 and document.sha256 == other.sha256) or (
            copies / sampled >= _DUPLICATE_SHARE
        ):
            return DUPLICATE
        if versions / sampled >= _VERSION_SHARE and same_name(document, other):
            return SUPERSEDED
        return None

    async def _conflict(self, found: list[tuple[str, Hit]]) -> str | None:
        """CONFLICT when the model finds the two closest passages contradicting."""
        text, hit = max(found, key=lambda pair: pair[1].score)
        if await self._judge.contradicts(text, hit.text):
            return CONFLICT
        return None

    async def _record(self, kind: str, document: DocInfo, other: DocInfo) -> None:
        """A version is about the older document; a duplicate or conflict about
        the newer one, so each pair has one finding whichever is processed first."""
        older, newer = sorted((document, other), key=lambda d: (d.created_at, d.id))
        about, against = (older, newer) if kind == SUPERSEDED else (newer, older)
        if await self._store.add_finding(kind, about.id, against.id):
            log.info("found %s: %s against %s", kind, about.id, against.id)
            if kind == SUPERSEDED:
                await self._scorer.rescore(about.id)


class FindingStore(Protocol):
    async def add_finding(
        self, kind: str, document_id: uuid.UUID, other_document_id: uuid.UUID
    ) -> bool: ...


# One trailing marker of a version or copy: "(2)", "(copy)", "final", "draft",
# "v2", "rev 1.3". Bare numbers are not markers ("Report 2023", "Chapter 2").
_VERSION_MARKER = re.compile(
    r"[\s._-]*(\(\d+\)|\(copy\)|copy|final|draft|(?:v|ver|version|rev)[\s._-]?\d+(?:\.\d+)*)$",
    re.IGNORECASE,
)
# Names are cut short before matching, which keeps the work small.
_MAX_NAME = 200


def name_stem(name: str) -> str:
    """A file or document name without its extension and trailing version
    markers ("Policy v2.pdf" and "policy_final.PDF" both give "policy")."""
    stem = name[:_MAX_NAME].strip()
    if re.search(r"\.[A-Za-z0-9]{1,5}$", stem):
        stem = stem.rsplit(".", 1)[0]
    while (shorter := _VERSION_MARKER.sub("", stem, count=1).strip()) not in (stem, ""):
        stem = shorter
    return stem.lower()


def same_name(a: DocInfo, b: DocInfo) -> bool:
    """Whether two documents look like versions of one another by their names."""
    return (a.filename and name_stem(a.filename) == name_stem(b.filename)) or (
        name_stem(a.title) == name_stem(b.title)
    )


def summary(finding: Finding, other_title: str) -> str:
    return {
        DUPLICATE: f"Duplicate of {other_title}",
        SUPERSEDED: f"Newer version of {other_title} exists",
        CONFLICT: f"Contradicts {other_title}",
    }[finding.kind]


def resolution_options(finding: Finding, title: str, other_title: str) -> list[tuple[str, str]]:
    """The ways to close a finding with what each does, from the point of view
    of the document it is about."""
    if finding.kind == SUPERSEDED:
        keep = f"Keep {title} as current: it no longer ranks lower for having a newer version."
        replace = f"Confirm that {other_title} replaces {title}: {title} keeps ranking lower."
    else:
        keep = f"Keep {title} and {other_title} as they are; both stay in use."
        replace = f"{other_title} replaces {title}: {title} ranks lower in answers."
    ignore = "Dismiss this finding; nothing changes."
    return [(KEEP, keep), (REPLACE, replace), (IGNORE, ignore)]
