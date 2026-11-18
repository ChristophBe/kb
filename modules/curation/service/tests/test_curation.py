import datetime
import uuid

import pytest
from knowcel_curation.curation import Scorer, Weights, score_document

from tests.fakes import NOW, FakeStore

DAY = datetime.timedelta(days=1)
WEIGHTS = Weights(
    recency=1, usage=0, half_life_days=100, replacement_penalty=0.5, usage_saturation=10
)


def test_a_fresh_document_scores_one() -> None:
    assert score_document(NOW, NOW, 0, 0, WEIGHTS) == 1


def test_recency_halves_every_half_life() -> None:
    assert score_document(NOW - 100 * DAY, NOW, 0, 0, WEIGHTS) == pytest.approx(0.5)
    assert score_document(NOW - 200 * DAY, NOW, 0, 0, WEIGHTS) == pytest.approx(0.25)
    # A timestamp ahead of the clock doesn't score above 1.
    assert score_document(NOW + DAY, NOW, 0, 0, WEIGHTS) == 1


def test_each_replacement_applies_the_penalty() -> None:
    assert score_document(NOW, NOW, 1, 0, WEIGHTS) == 0.5
    assert score_document(NOW, NOW, 3, 0, WEIGHTS) == 0.125


def test_usage_counts_only_with_a_weight() -> None:
    old = NOW - 100 * DAY
    # Weight 0: citations change nothing.
    assert score_document(old, NOW, 0, 10, WEIGHTS) == pytest.approx(0.5)
    both = Weights(1, 1, 100, 0.5, 10)
    # (1 * 0.5 + 1 * usage) / 2
    assert score_document(old, NOW, 0, 0, both) == pytest.approx(0.25)
    assert score_document(old, NOW, 0, 5, both) == pytest.approx(0.5)
    assert score_document(old, NOW, 0, 10, both) == pytest.approx(0.75)
    # Saturates at usage_saturation.
    assert score_document(old, NOW, 0, 1000, both) == pytest.approx(0.75)


def test_weights_set_the_balance() -> None:
    old = NOW - 100 * DAY
    mostly_usage = Weights(1, 3, 100, 0.5, 10)
    # (1 * 0.5 + 3 * 1) / 4
    assert score_document(old, NOW, 0, 10, mostly_usage) == pytest.approx(0.875)


async def test_a_processed_document_gets_a_score() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    await Scorer(store, WEIGHTS).on_processed(document, datetime.datetime.now(datetime.UTC))
    assert store.scores[document].score == pytest.approx(1, abs=0.01)


async def test_a_replaced_document_scores_lower_than_before() -> None:
    store = FakeStore()
    scorer = Scorer(store, WEIGHTS)
    older, newer = uuid.uuid4(), uuid.uuid4()
    now = datetime.datetime.now(datetime.UTC)
    await scorer.on_processed(older, now)
    before = store.scores[older].score
    # The newer version arrives and is found to replace the older one.
    await scorer.on_processed(newer, now)
    store.supersede(older, newer)
    await scorer.rescore(older)
    assert store.scores[older].score == pytest.approx(before * 0.5)
    assert store.scores[newer].score == pytest.approx(before)


async def test_reprocessing_keeps_the_newest_time() -> None:
    store = FakeStore()
    scorer = Scorer(store, WEIGHTS)
    document = uuid.uuid4()
    now = datetime.datetime.now(datetime.UTC)
    await scorer.on_processed(document, now)
    # A redelivered, older event doesn't age the document.
    await scorer.on_processed(document, now - 50 * DAY)
    assert store.scores[document].processed_at == now
    # A newer one refreshes it.
    later = now + DAY
    await scorer.on_processed(document, later)
    assert store.scores[document].processed_at == later


async def test_rescoring_an_unscored_document_does_nothing() -> None:
    store = FakeStore()
    await Scorer(store, WEIGHTS).rescore(uuid.uuid4())
    assert not store.scores
