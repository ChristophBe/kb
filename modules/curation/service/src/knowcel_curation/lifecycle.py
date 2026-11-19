"""Where documents stand in review and approval: who may change it, what a
change does, and the documents whose review is due."""

import datetime
import logging
import uuid

from knowcel_platform.grpc import Principal

from .curation import REVIEW_DUE, CurationStore, DocInfo, Lifecycle, Scorer

log = logging.getLogger("knowcel_curation")

# Documents past their review date opened as findings per run.
_REVIEW_BATCH = 500


def may_change(document: DocInfo, user: str, principal: Principal | None) -> bool:
    """The owner of a document, an admin of a team it is shared with and a
    platform admin may change its lifecycle."""
    if user == document.owner_id:
        return True
    if principal is None:
        return False
    return principal.platform_admin or any(principal.is_team_admin(t) for t in document.team_ids)


class LifecycleService:
    def __init__(self, store: CurationStore, scorer: Scorer) -> None:
        self._store = store
        self._scorer = scorer

    async def set(self, document_id: uuid.UUID, lifecycle: Lifecycle, note: str, user: str) -> None:
        """Records the change and scores the document again. Its review-due
        finding goes: a new review date starts over, and the job opens a new
        one when that passes."""
        await self._store.add_lifecycle_change(document_id, lifecycle, note, user)
        await self._store.delete_review_due(document_id)
        await self._scorer.rescore(document_id)

    async def open_review_findings(self) -> None:
        """Opens a REVIEW_DUE finding for each document past its review date."""
        now = datetime.datetime.now(datetime.UTC)
        for document_id in await self._store.list_review_due(now, _REVIEW_BATCH):
            if await self._store.add_finding(REVIEW_DUE, document_id, document_id):
                log.info("review of document %s is due", document_id)
