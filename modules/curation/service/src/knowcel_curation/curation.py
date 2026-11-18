"""The scores and findings the curation module keeps; db.py implements the store."""

import datetime
import uuid
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Score:
    document_id: uuid.UUID
    score: float
    updated_at: datetime.datetime


@dataclass(frozen=True)
class Finding:
    id: uuid.UUID
    # duplicate, superseded or conflict
    kind: str
    document_id: uuid.UUID
    other_document_id: uuid.UUID
    created_at: datetime.datetime


class CurationStore(Protocol):
    async def get_score(self, document_id: uuid.UUID) -> Score | None: ...

    async def list_findings(self) -> list[Finding]: ...
