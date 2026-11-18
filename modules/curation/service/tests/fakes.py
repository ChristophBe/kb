import datetime
import uuid
from collections.abc import Collection

from knowcel_curation.curation import Finding, PeerUnavailableError, Score

NOW = datetime.datetime(2026, 11, 18, tzinfo=datetime.UTC)


class FakeStore:
    def __init__(self) -> None:
        self.scores: dict[uuid.UUID, Score] = {}
        self.findings: list[Finding] = []
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
            1 for f in self.findings if f.document_id == document_id and f.kind == "superseded"
        )

    async def list_scores(self, after: uuid.UUID | None, limit: int) -> list[Score]:
        self._check()
        ordered = sorted(self.scores.values(), key=lambda s: s.document_id)
        return [s for s in ordered if after is None or s.document_id > after][:limit]

    async def list_findings(self) -> list[Finding]:
        self._check()
        return self.findings

    def supersede(self, older: uuid.UUID, newer: uuid.UUID) -> None:
        self.findings.append(Finding(uuid.uuid4(), "superseded", older, newer, NOW))

    def _check(self) -> None:
        if self.down:
            from sqlalchemy.exc import OperationalError

            raise OperationalError("select", {}, Exception("down"))


class FakeDocuments:
    """The documents the caller can see."""

    def __init__(self, *visible: uuid.UUID) -> None:
        self.ids = set(visible)
        self.down = False
        self.asked: list[set[uuid.UUID]] = []

    async def visible(self, document_ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
        self.asked.append(set(document_ids))
        if self.down:
            raise PeerUnavailableError("document UNAVAILABLE")
        return self.ids & set(document_ids)
