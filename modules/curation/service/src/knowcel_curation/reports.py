"""Reports of documents: who reports, who sees the reports, what they do."""

import logging
import uuid

from knowcel_platform.grpc import Principal

from .curation import REPORTED, CurationStore, DocInfo, Report, Scorer
from .lifecycle import may_change

log = logging.getLogger("knowcel_curation")


def sees_all_reports(document: DocInfo, user: str, principal: Principal | None) -> bool:
    """Those who may change a document's lifecycle see every report of it;
    everyone else only their own."""
    return may_change(document, user, principal)


def visible_reports(
    reports: list[Report], document: DocInfo, user: str, principal: Principal | None
) -> list[Report]:
    if sees_all_reports(document, user, principal):
        return reports
    return [r for r in reports if r.reporter == user]


class ReportService:
    def __init__(self, store: CurationStore, scorer: Scorer) -> None:
        self._store = store
        self._scorer = scorer

    async def report(self, document_id: uuid.UUID, user: str, reason: str, comment: str) -> None:
        """Records the user's report and makes sure the document has an open
        finding for it. A finding that was dismissed earlier is made anew: these
        are new reports."""
        await self._store.save_report(document_id, user, reason, comment)
        await self._store.delete_resolved_finding(REPORTED, document_id)
        if await self._store.add_finding(REPORTED, document_id, document_id):
            log.info("document %s was reported", document_id)
        await self._scorer.rescore(document_id)
