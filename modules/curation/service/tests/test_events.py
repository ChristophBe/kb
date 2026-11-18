import datetime
import uuid

from knowcel.ingestion.v1 import events_pb2
from knowcel_curation.curation import PeerError, PeerUnavailableError, Scorer, Weights
from knowcel_curation.events import RETRY_DELAY, deliver
from knowcel_curation.findings import Detector, Thresholds

from tests.fakes import NOW, FakeCorpus, FakeEmbedder, FakeJudge, FakeStore

WEIGHTS = Weights(
    recency=1, usage=0, half_life_days=100, replacement_penalty=0.5, usage_saturation=10
)
THRESHOLDS = Thresholds(0.97, 0.85, 0.75, 3, 2)


class FakeDelivery:
    def __init__(
        self, document_id: str, owner_id: str = "alice", data: bytes | None = None
    ) -> None:
        event = events_pb2.DocumentProcessed(
            job_id="j", document_id=document_id, chunk_count=3, owner_id=owner_id
        )
        self.data = data if data is not None else event.SerializeToString()
        self.headers: dict[str, str] | None = None
        self.timestamp: datetime.datetime = NOW
        self.acked = False
        self.naked: float | None = None

    async def ack(self) -> None:
        self.acked = True

    async def nak(self, delay: float | None = None) -> None:
        self.naked = delay


class RecordingDetector(Detector):
    def __init__(self, store: FakeStore, failure: Exception | None = None) -> None:
        super().__init__(
            store,
            FakeCorpus(),
            FakeEmbedder(),
            FakeJudge(),
            Scorer(store, WEIGHTS),
            THRESHOLDS,
        )
        self.detected: list[tuple[uuid.UUID, str]] = []
        self.failure = failure

    async def detect(self, document_id: uuid.UUID, owner_id: str) -> None:
        self.detected.append((document_id, owner_id))
        if self.failure:
            raise self.failure


async def handle(msg: FakeDelivery, store: FakeStore, detector: RecordingDetector) -> None:
    await deliver(Scorer(store, WEIGHTS), detector, msg)


async def test_a_processed_event_scores_its_document_and_looks_for_findings() -> None:
    store = FakeStore()
    detector = RecordingDetector(store)
    document = uuid.uuid4()
    msg = FakeDelivery(str(document))
    await handle(msg, store, detector)
    assert msg.acked
    assert store.scores[document].processed_at == NOW
    assert detector.detected == [(document, "alice")]


async def test_an_event_without_an_owner_is_only_scored() -> None:
    store = FakeStore()
    detector = RecordingDetector(store)
    document = uuid.uuid4()
    msg = FakeDelivery(str(document), owner_id="")
    await handle(msg, store, detector)
    assert msg.acked
    assert document in store.scores
    assert not detector.detected


async def test_an_event_with_a_broken_id_is_dropped() -> None:
    store = FakeStore()
    msg = FakeDelivery("not-an-id")
    await handle(msg, store, RecordingDetector(store))
    assert msg.acked
    assert not store.scores


async def test_an_unreadable_event_is_dropped() -> None:
    store = FakeStore()
    msg = FakeDelivery("", data=b"\xff\xff\xff")
    await handle(msg, store, RecordingDetector(store))
    assert msg.acked
    assert not store.scores


async def test_a_timestamp_without_a_zone_is_taken_as_utc() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    msg = FakeDelivery(str(document))
    msg.timestamp = NOW.replace(tzinfo=None)
    await handle(msg, store, RecordingDetector(store))
    assert msg.acked
    assert store.scores[document].processed_at == NOW


async def test_a_database_outage_retries_later() -> None:
    store = FakeStore()
    store.down = True
    msg = FakeDelivery(str(uuid.uuid4()))
    await handle(msg, store, RecordingDetector(store))
    assert not msg.acked
    assert msg.naked == RETRY_DELAY


async def test_an_unavailable_peer_retries_later() -> None:
    store = FakeStore()
    msg = FakeDelivery(str(uuid.uuid4()))
    await handle(msg, store, RecordingDetector(store, PeerUnavailableError("llm UNAVAILABLE")))
    assert not msg.acked
    assert msg.naked == RETRY_DELAY


async def test_a_refusing_peer_is_retried_too_and_the_score_is_kept() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    msg = FakeDelivery(str(document))
    await handle(msg, store, RecordingDetector(store, PeerError("llm INTERNAL")))
    assert not msg.acked
    assert msg.naked == RETRY_DELAY
    assert document in store.scores
