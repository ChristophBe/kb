import datetime
import uuid

import pytest
from knowcel_curation.curation import REVIEW_DUE, Lifecycle, Scorer, Weights
from knowcel_curation.lifecycle import LifecycleService, may_change
from knowcel_platform.grpc import Principal, Team

from tests.fakes import DAY, FakeStore, doc

WEIGHTS = Weights(1, 0, 100, 0.5, 10, deprecated_factor=0.1)
TEAM, OTHER_TEAM = str(uuid.uuid4()), str(uuid.uuid4())


def test_the_owner_may_change_the_lifecycle() -> None:
    assert may_change(doc(owner="alice"), "alice", None)
    assert not may_change(doc(owner="alice"), "bob", None)


def test_an_admin_of_a_team_the_document_is_shared_with_may() -> None:
    document = doc(owner="alice", teams=[TEAM])
    admin = Principal("bob", teams=(Team(TEAM, admin=True),))
    member = Principal("carol", teams=(Team(TEAM, admin=False),))
    other_team_admin = Principal("dave", teams=(Team(OTHER_TEAM, admin=True),))
    assert may_change(document, "bob", admin)
    assert not may_change(document, "carol", member)
    assert not may_change(document, "dave", other_team_admin)


def test_a_platform_admin_may() -> None:
    assert may_change(doc(owner="alice"), "root", Principal("root", platform_admin=True))
    assert not may_change(doc(owner="alice"), "root", Principal("root"))


async def test_a_change_is_kept_in_the_history_and_scores_the_document_again() -> None:
    store = FakeStore()
    scorer = Scorer(store, WEIGHTS)
    service = LifecycleService(store, scorer)
    document = uuid.uuid4()
    await scorer.on_processed(document, datetime.datetime.now(datetime.UTC))
    before = store.scores[document].score
    await service.set(document, Lifecycle("approved", "alice"), "checked", "alice")
    await service.set(document, Lifecycle("deprecated", "alice"), "outdated", "bob")
    history = await store.list_lifecycle_history(document)
    assert [(c.lifecycle.state, c.note, c.changed_by) for c in history] == [
        ("deprecated", "outdated", "bob"),
        ("approved", "checked", "alice"),
    ]
    assert store.scores[document].score == pytest.approx(before * 0.1)


async def test_a_document_past_its_review_date_gets_one_finding() -> None:
    store = FakeStore()
    service = LifecycleService(store, Scorer(store, WEIGHTS))
    late, on_time, archived = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = datetime.datetime.now(datetime.UTC)
    await service.set(late, Lifecycle("approved", "alice", now - DAY), "", "alice")
    await service.set(on_time, Lifecycle("approved", "alice", now + DAY), "", "alice")
    await service.set(archived, Lifecycle("archived", "alice", now - DAY), "", "alice")
    await service.open_review_findings()
    await service.open_review_findings()
    (finding,) = store.findings
    assert (finding.kind, finding.document_id, finding.other_document_id) == (
        REVIEW_DUE,
        late,
        late,
    )


async def test_a_new_review_date_closes_the_finding_and_the_next_miss_opens_a_new_one() -> None:
    store = FakeStore()
    service = LifecycleService(store, Scorer(store, WEIGHTS))
    document = uuid.uuid4()
    now = datetime.datetime.now(datetime.UTC)
    await service.set(document, Lifecycle("approved", "alice", now - DAY), "", "alice")
    await service.open_review_findings()
    assert len(store.findings) == 1
    await service.set(document, Lifecycle("approved", "alice", now + 30 * DAY), "", "alice")
    assert not store.findings
    await service.set(document, Lifecycle("approved", "alice", now - DAY), "", "alice")
    await service.open_review_findings()
    assert len(store.findings) == 1
