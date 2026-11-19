"""Ratings: whether users found a document, or a passage of it, helpful."""

import logging
import uuid

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
    ) -> None:
        """Saves the user's rating, replacing their earlier one for the same
        document or passage, or takes it back (`rating` is None), and scores the
        document again."""
        if rating is None:
            await self._store.delete_rating(document_id, user, chunk_index)
        else:
            await self._store.save_rating(document_id, user, chunk_index, rating, conversation_id)
        await self._scorer.rescore(document_id)
