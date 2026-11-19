import asyncio
import datetime
import uuid

import pytest
from knowcel_curation.curation import Lifecycle, Scorer, Weights, run_periodically, score_document

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
    await store.add_finding("superseded", older, newer)
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


async def test_rescoring_all_ages_every_score() -> None:
    store = FakeStore()
    scorer = Scorer(store, WEIGHTS)
    ids = [uuid.uuid4() for _ in range(5)]
    old = datetime.datetime.now(datetime.UTC) - 100 * DAY
    for document in ids:
        await store.save_score(document, old, 1.0)
    await scorer.rescore_all(batch=2)
    assert [round(store.scores[i].score, 2) for i in ids] == [0.5] * 5


async def test_scores_are_rescored_periodically_until_stopped() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    await store.save_score(document, datetime.datetime.now(datetime.UTC) - 100 * DAY, 1.0)
    stop = asyncio.Event()
    task = asyncio.create_task(run_periodically([Scorer(store, WEIGHTS).rescore_all], 0.01, stop))
    for _ in range(100):
        await asyncio.sleep(0.01)
        if store.scores[document].score < 1:
            break
    stop.set()
    await asyncio.wait_for(task, 1)
    assert store.scores[document].score == pytest.approx(0.5, abs=0.01)


async def test_a_failing_rescore_is_retried() -> None:
    store = FakeStore()
    store.down = True
    stop = asyncio.Event()
    task = asyncio.create_task(run_periodically([Scorer(store, WEIGHTS).rescore_all], 0.01, stop))
    await asyncio.sleep(0.05)
    assert not task.done()
    stop.set()
    await asyncio.wait_for(task, 1)


def test_the_lifecycle_state_raises_or_lowers_the_score() -> None:
    weights = Weights(
        1, 0, 100, 0.5, 10, approved_boost=1.5, deprecated_factor=0.1, archived_factor=0.01
    )
    old = NOW - 100 * DAY  # a score of 0.5
    score = lambda state: score_document(old, NOW, 0, 0, weights, state)  # noqa: E731
    assert score(None) == pytest.approx(0.5)
    assert score("draft") == pytest.approx(0.5)
    assert score("in_review") == pytest.approx(0.5)
    assert score("approved") == pytest.approx(0.75)
    assert score("deprecated") == pytest.approx(0.05)
    assert score("archived") == pytest.approx(0.005)
    # An approved document never scores above 1.
    assert score_document(NOW, NOW, 0, 0, weights, "approved") == 1


async def test_a_documents_state_counts_when_it_is_scored() -> None:
    store = FakeStore()
    weights = Weights(1, 0, 100, 0.5, 10, deprecated_factor=0.1)
    scorer = Scorer(store, weights)
    document = uuid.uuid4()
    await scorer.on_processed(document, datetime.datetime.now(datetime.UTC))
    before = store.scores[document].score
    await store.add_lifecycle_change(document, Lifecycle("deprecated", "alice"), "", "alice")
    await scorer.rescore(document)
    assert store.scores[document].score == pytest.approx(before * 0.1)


async def test_every_job_runs_and_a_failing_one_does_not_stop_the_others() -> None:
    ran: list[str] = []

    async def failing() -> None:
        ran.append("failing")
        raise RuntimeError("boom")

    async def working() -> None:
        ran.append("working")

    stop = asyncio.Event()
    task = asyncio.create_task(run_periodically([failing, working], 0.01, stop))
    for _ in range(100):
        await asyncio.sleep(0.01)
        if "working" in ran:
            break
    stop.set()
    await asyncio.wait_for(task, 1)
    assert ran[:2] == ["failing", "working"]


async def test_rescoring_all_looks_up_the_lifecycles_of_a_batch_at_once() -> None:
    store = FakeStore()
    lookups: list[int] = []
    original = store.get_lifecycles

    async def counting(ids):  # type: ignore[no-untyped-def]
        lookups.append(len(ids))
        return await original(ids)

    store.get_lifecycles = counting  # type: ignore[method-assign]
    scorer = Scorer(store, WEIGHTS)
    ids = [uuid.uuid4() for _ in range(5)]
    for document in ids:
        await store.save_score(document, NOW, 1.0)
    await scorer.rescore_all(batch=3)
    assert lookups == [3, 2]


def test_reports_lower_the_score_once_per_reporter_down_to_a_floor() -> None:
    weights = Weights(1, 0, 100, 0.5, 10, report_penalty=0.8, report_floor=0.5)
    score = lambda reports: score_document(NOW, NOW, 0, 0, weights, None, reports)  # noqa: E731
    assert score(0) == 1
    assert score(1) == pytest.approx(0.8)
    assert score(2) == pytest.approx(0.64)
    assert score(3) == pytest.approx(0.512)
    assert score(4) == pytest.approx(0.5)
    assert score(10) == pytest.approx(0.5)
    # Reports and a replacement add up, and the state still counts after them.
    assert score_document(NOW, NOW, 1, 0, weights, "deprecated", 1) == pytest.approx(0.5 * 0.8)
