import datetime
import uuid

from knowcel.ingestion.v1 import events_pb2
from knowcel_curation.curation import Scorer, Weights
from knowcel_curation.events import RETRY_DELAY, deliver

from tests.fakes import NOW, FakeStore

WEIGHTS = Weights(
    recency=1, usage=0, half_life_days=100, replacement_penalty=0.5, usage_saturation=10
)


class FakeDelivery:
    def __init__(self, document_id: str, data: bytes | None = None) -> None:
        event = events_pb2.DocumentProcessed(job_id="j", document_id=document_id, chunk_count=3)
        self.data = data if data is not None else event.SerializeToString()
        self.headers: dict[str, str] | None = None
        self.timestamp: datetime.datetime = NOW
        self.acked = False
        self.naked: float | None = None

    async def ack(self) -> None:
        self.acked = True

    async def nak(self, delay: float | None = None) -> None:
        self.naked = delay


async def test_a_processed_event_scores_its_document() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    msg = FakeDelivery(str(document))
    await deliver(Scorer(store, WEIGHTS), msg)
    assert msg.acked
    assert store.scores[document].processed_at == NOW


async def test_an_event_with_a_broken_id_is_dropped() -> None:
    store = FakeStore()
    msg = FakeDelivery("not-an-id")
    await deliver(Scorer(store, WEIGHTS), msg)
    assert msg.acked
    assert not store.scores


async def test_a_database_outage_retries_later() -> None:
    store = FakeStore()
    store.down = True
    msg = FakeDelivery(str(uuid.uuid4()))
    await deliver(Scorer(store, WEIGHTS), msg)
    assert not msg.acked
    assert msg.naked == RETRY_DELAY


async def test_an_unreadable_event_is_dropped() -> None:
    store = FakeStore()
    msg = FakeDelivery("", data=b"\xff\xff\xff")
    await deliver(Scorer(store, WEIGHTS), msg)
    assert msg.acked
    assert not store.scores


async def test_a_timestamp_without_a_zone_is_taken_as_utc() -> None:
    store = FakeStore()
    document = uuid.uuid4()
    msg = FakeDelivery(str(document))
    msg.timestamp = NOW.replace(tzinfo=None)
    await deliver(Scorer(store, WEIGHTS), msg)
    assert msg.acked
    assert store.scores[document].processed_at == NOW
