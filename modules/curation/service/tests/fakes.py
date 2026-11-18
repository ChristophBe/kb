import datetime
import uuid
from collections.abc import Collection, Sequence

from knowcel_curation.curation import (
    DocInfo,
    Finding,
    FindingCursor,
    PeerUnavailableError,
    Score,
)
from knowcel_curation.findings import Hit
from sqlalchemy.exc import OperationalError

NOW = datetime.datetime(2026, 11, 18, tzinfo=datetime.UTC)
DAY = datetime.timedelta(days=1)


def doc(
    title: str = "Handbook", *, filename: str = "", sha256: str = "", age_days: float = 0
) -> DocInfo:
    return DocInfo(uuid.uuid4(), title, filename or title + ".md", sha256, NOW - age_days * DAY)


class FakeStore:
    def __init__(self) -> None:
        self.scores: dict[uuid.UUID, Score] = {}
        self.findings: list[Finding] = []
        self.resolved_by: dict[uuid.UUID, str] = {}
        self.down = False

    async def get_scores(self, document_ids: Collection[uuid.UUID]) -> list[Score]:
        self._check()
        return [s for i, s in self.scores.items() if i in document_ids]

    async def save_score(
        self, document_id: uuid.UUID, processed_at: datetime.datetime, score: float
    ) -> None:
        self._check()
        self.scores[document_id] = Score(document_id, score, processed_at, NOW)

    async def count_replacements(self, document_id: uuid.UUID) -> int:
        self._check()
        return sum(
            1
            for f in self.findings
            if f.document_id == document_id
            and ((f.kind == "superseded" and f.resolution is None) or f.resolution == "replace")
        )

    async def list_scores(self, after: uuid.UUID | None, limit: int) -> list[Score]:
        self._check()
        ordered = sorted(self.scores.values(), key=lambda s: s.document_id)
        return [s for s in ordered if after is None or s.document_id > after][:limit]

    async def add_finding(
        self, kind: str, document_id: uuid.UUID, other_document_id: uuid.UUID
    ) -> bool:
        self._check()
        if any(
            (f.kind, f.document_id, f.other_document_id) == (kind, document_id, other_document_id)
            for f in self.findings
        ):
            return False
        self.findings.append(Finding(uuid.uuid4(), kind, document_id, other_document_id, NOW))
        return True

    async def get_finding(self, finding_id: uuid.UUID) -> Finding | None:
        self._check()
        return next((f for f in self.findings if f.id == finding_id), None)

    async def resolve_finding(self, finding_id: uuid.UUID, resolution: str, user: str) -> bool:
        self._check()
        for i, f in enumerate(self.findings):
            if f.id == finding_id and f.resolution is None:
                self.findings[i] = Finding(
                    f.id, f.kind, f.document_id, f.other_document_id, f.created_at, resolution
                )
                self.resolved_by[finding_id] = user
                return True
        return False

    async def list_open_findings(
        self, limit: int, after: FindingCursor | None = None
    ) -> list[Finding]:
        self._check()

        def key(f: Finding) -> tuple[float, uuid.UUID]:
            return (-f.created_at.timestamp(), f.id)

        ordered = sorted((f for f in self.findings if f.resolution is None), key=key)
        if after is not None:
            ordered = [f for f in ordered if key(f) > (-after.created_at.timestamp(), after.id)]
        return ordered[:limit]

    def _check(self) -> None:
        if self.down:
            raise OperationalError("select", {}, Exception("down"))


class FakeDocuments:
    """The documents the caller can read."""

    def __init__(self, *readable: DocInfo) -> None:
        self.docs = {d.id: d for d in readable}
        self.down = False
        self.asked: list[set[uuid.UUID]] = []

    async def readable(self, document_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, DocInfo]:
        self.asked.append(set(document_ids))
        if self.down:
            raise PeerUnavailableError("document UNAVAILABLE")
        return {i: self.docs[i] for i in document_ids if i in self.docs}


class FakeCorpus:
    """What the owner of a document can read, and which passages resemble the
    ones asked about."""

    def __init__(self, *docs: DocInfo) -> None:
        self.docs = {d.id: d for d in docs}
        self.passages: dict[uuid.UUID, list[str]] = {}
        # Hits per searched vector, in the order of the sampled passages.
        self.hits: list[list[Hit]] = []
        self.searches = 0
        self.users: set[str | None] = set()

    async def get(self, document_id: uuid.UUID) -> DocInfo | None:
        from knowcel_platform.grpc import current_user

        self.users.add(current_user())
        return self.docs.get(document_id)

    async def sample(self, document_id: uuid.UUID, count: int) -> list[str]:
        return self.passages.get(document_id, [])[:count]

    async def similar(self, embedding: Sequence[float], model: str, limit: int) -> list[Hit]:
        hits = self.hits[self.searches]
        self.searches += 1
        return hits


class FakeEmbedder:
    async def embed(self, texts: Sequence[str]) -> tuple[list[list[float]], str]:
        return [[float(i)] for i in range(len(texts))], "fake-embed"


class FakeJudge:
    def __init__(self, contradicts: bool = False) -> None:
        self.answer = contradicts
        self.asked: list[tuple[str, str]] = []

    async def contradicts(self, first: str, second: str) -> bool:
        self.asked.append((first, second))
        return self.answer
