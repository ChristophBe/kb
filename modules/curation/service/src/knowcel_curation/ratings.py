"""Ratings: whether users found a document, or a passage of it, helpful."""

import datetime
import logging
import uuid

from sqlalchemy.exc import SQLAlchemyError

from .curation import CurationStore, Scorer

log = logging.getLogger("knowcel_curation")


class RatingService:
    def __init__(self, store: CurationStore, scorer: Scorer) -> None:
        self._store = store
        self._scorer = scorer

    async def rate(
        self,
        document_id: uuid.UUID,
        user: str,
        chunk_index: int | None,
        rating: str | None,
        conversation_id: str,
        created_at: datetime.datetime | None = None,
    ) -> None:
        """Saves the user's rating, replacing their earlier one for the same
        document or passage, or takes it back (`rating` is None), and scores the
        document again (from `created_at` when it has no score yet). The rating is
        saved when the scoring fails; the next periodic scoring catches up."""
        if rating is None:
            await self._store.delete_rating(document_id, user, chunk_index)
        else:
            await self._store.save_rating(document_id, user, chunk_index, rating, conversation_id)
        try:
            await self._scorer.rescore(document_id, created_at)
        except SQLAlchemyError:
            log.exception("scoring document %s again failed", document_id)
