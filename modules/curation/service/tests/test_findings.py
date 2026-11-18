import uuid

import pytest
from knowcel_curation.curation import (
    CONFLICT,
    DUPLICATE,
    SUPERSEDED,
    DocInfo,
    Finding,
    Scorer,
    Weights,
)
from knowcel_curation.findings import (
    Detector,
    Hit,
    Thresholds,
    name_stem,
    resolution_options,
    same_name,
    summary,
)

from tests.fakes import (
    NOW,
    FakeCorpus,
    FakeEmbedder,
    FakeJudge,
    FakeStore,
    doc,
)

WEIGHTS = Weights(
    recency=1, usage=0, half_life_days=100, replacement_penalty=0.5, usage_saturation=1
)
THRESHOLDS = Thresholds(
    duplicate=0.97, version=0.85, conflict=0.75, sample_chunks=3, conflict_checks=2
)
TEXTS = ["alpha", "beta", "gamma"]


class Setup:
    def __init__(
        self,
        new: DocInfo,
        old: DocInfo,
        scores: list[float],
        *,
        judge: bool = False,
        checks: int = 2,
    ) -> None:
        self.store = FakeStore()
        self.corpus = FakeCorpus(new, old)
        self.corpus.passages[new.id] = TEXTS
        self.corpus.hits = [
            [Hit(old.id, s, f"old {t}"), Hit(new.id, 1.0, t)]
            for s, t in zip(scores, TEXTS, strict=True)
        ]
        self.judge = FakeJudge(judge)
        self.scorer = Scorer(self.store, WEIGHTS)
        thresholds = Thresholds(0.97, 0.85, 0.75, 3, checks)
        self.detector = Detector(
            self.store, self.corpus, FakeEmbedder(), self.judge, self.scorer, thresholds
        )
        self.new, self.old = new, old

    async def run(self) -> list[Finding]:
        await self.scorer.on_processed(self.old.id, NOW)
        await self.detector.detect(self.new.id, "alice")
        return self.store.findings


async def test_the_same_content_twice_is_a_duplicate_of_the_older_document() -> None:
    new, old = doc("Handbook copy"), doc("Handbook", age_days=3)
    (found,) = await Setup(new, old, [0.99, 0.98, 0.99]).run()
    assert (found.kind, found.document_id, found.other_document_id) == (DUPLICATE, new.id, old.id)


async def test_the_same_file_is_a_duplicate_even_without_similar_passages() -> None:
    new, old = doc(sha256="abc"), doc("Other", sha256="abc", age_days=3)
    (found,) = await Setup(new, old, [0.8, 0.8, 0.8]).run()
    assert found.kind == DUPLICATE


async def test_a_revised_version_supersedes_the_older_document() -> None:
    new, old = (
        doc("Policy v2", filename="policy_v2.pdf"),
        doc("Policy", filename="policy_v1.pdf", age_days=30),
    )
    setup = Setup(new, old, [0.9, 0.91, 0.5])
    (found,) = await setup.run()
    assert (found.kind, found.document_id, found.other_document_id) == (SUPERSEDED, old.id, new.id)
    assert await setup.store.count_replacements(old.id) == 1


async def test_a_replaced_document_scores_lower() -> None:
    new = doc("Policy v2", filename="policy_v2.pdf")
    old = doc("Policy", filename="policy_v1.pdf", age_days=30)
    setup = Setup(new, old, [0.9, 0.9, 0.9])
    await setup.scorer.on_processed(old.id, NOW)
    before = setup.store.scores[old.id].score
    await setup.run()
    assert setup.store.scores[old.id].score == pytest.approx(before * 0.5, rel=0.01)


async def test_similar_documents_with_other_names_are_checked_for_conflicts() -> None:
    new, old = doc("Pricing 2026"), doc("Pricing FAQ", age_days=3)
    setup = Setup(new, old, [0.9, 0.8, 0.5], judge=True)
    (found,) = await setup.run()
    assert (found.kind, found.document_id, found.other_document_id) == (CONFLICT, new.id, old.id)
    # The model compares the closest pair of passages.
    assert setup.judge.asked == [("alpha", "old alpha")]


async def test_consistent_documents_have_no_finding() -> None:
    new, old = doc("Pricing 2026"), doc("Pricing FAQ", age_days=3)
    setup = Setup(new, old, [0.9, 0.8, 0.5], judge=False)
    assert await setup.run() == []
    assert len(setup.judge.asked) == 1


async def test_conflict_detection_can_be_turned_off() -> None:
    new, old = doc("Pricing 2026"), doc("Pricing FAQ", age_days=3)
    setup = Setup(new, old, [0.9, 0.8, 0.5], judge=True, checks=0)
    assert await setup.run() == []
    assert not setup.judge.asked


async def test_unrelated_documents_have_no_finding() -> None:
    new, old = doc("Pricing 2026"), doc("Holiday rota", age_days=3)
    setup = Setup(new, old, [0.5, 0.4, 0.6], judge=True)
    assert await setup.run() == []
    assert not setup.judge.asked


async def test_detecting_again_adds_nothing_and_work_is_done_as_the_owner() -> None:
    new, old = doc("Handbook copy"), doc("Handbook", age_days=3)
    setup = Setup(new, old, [0.99, 0.99, 0.99])
    await setup.run()
    setup.corpus.searches = 0
    await setup.detector.detect(new.id, "alice")
    assert len(setup.store.findings) == 1
    assert setup.corpus.users == {"alice"}


async def test_the_pair_gets_one_finding_whichever_document_is_processed_first() -> None:
    new, old = doc("Handbook copy"), doc("Handbook", age_days=3)
    setup = Setup(new, old, [0.99, 0.99, 0.99])
    await setup.run()
    # Now the older one is processed again and finds the newer.
    setup.corpus.passages[old.id] = TEXTS
    setup.corpus.hits = [[Hit(new.id, 0.99, t)] for t in TEXTS]
    setup.corpus.searches = 0
    await setup.detector.detect(old.id, "alice")
    assert len(setup.store.findings) == 1


async def test_a_deleted_document_is_skipped() -> None:
    store = FakeStore()
    corpus = FakeCorpus()
    detector = Detector(
        store, corpus, FakeEmbedder(), FakeJudge(), Scorer(store, WEIGHTS), THRESHOLDS
    )
    await detector.detect(uuid.uuid4(), "alice")
    assert not store.findings


async def test_a_document_without_text_is_skipped() -> None:
    new = doc()
    store = FakeStore()
    corpus = FakeCorpus(new)
    detector = Detector(
        store, corpus, FakeEmbedder(), FakeJudge(), Scorer(store, WEIGHTS), THRESHOLDS
    )
    await detector.detect(new.id, "alice")
    assert not store.findings


@pytest.mark.parametrize(
    ("name", "stem"),
    [
        ("Policy v2.pdf", "policy"),
        ("policy_final.PDF", "policy"),
        ("policy (1).docx", "policy"),
        ("policy-2024.md", "policy"),
        ("Q3 report", "q3 report"),
        ("2024.pdf", "2024"),
        ("notes.v1.txt", "notes"),
    ],
)
def test_name_stem(name: str, stem: str) -> None:
    assert name_stem(name) == stem


def test_versions_are_recognised_by_name() -> None:
    assert same_name(doc("A", filename="policy_v1.pdf"), doc("B", filename="policy_v2.pdf"))
    assert same_name(doc("Handbook", filename=""), doc("handbook (copy)", filename=""))
    assert not same_name(
        doc("Pricing", filename="pricing.md"), doc("Holidays", filename="holidays.md")
    )


def test_findings_are_worded_for_people() -> None:
    def finding(kind: str) -> Finding:
        return Finding(uuid.uuid4(), kind, uuid.uuid4(), uuid.uuid4(), NOW)

    assert summary(finding(DUPLICATE), "Handbook") == "Duplicate of Handbook"
    assert summary(finding(SUPERSEDED), "Handbook") == "Newer version of Handbook exists"
    assert summary(finding(CONFLICT), "Handbook") == "Contradicts Handbook"
    options = dict(resolution_options(finding(SUPERSEDED), "Old", "New"))
    assert set(options) == {"keep", "replace", "ignore"}
    assert "New replaces Old" in options["replace"]
    assert all(options.values())
