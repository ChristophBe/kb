import asyncio
import logging

from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel.document.v1 import document_pb2_grpc
from knowcel.llm.v1 import llm_pb2_grpc
from knowcel_platform.config import load_settings
from knowcel_platform.grpc import channel, serve
from knowcel_platform.logging import setup_logging
from knowcel_platform.metrics import start_metrics_server
from knowcel_platform.nats import connect, ensure_stream
from knowcel_platform.telemetry import setup_tracing
from sqlalchemy.ext.asyncio import create_async_engine

from .config import Settings
from .curation import Scorer, rescore_periodically
from .db import SqlCurationStore, migrate
from .events import STREAM, consume
from .findings import Detector
from .peers import PeerDocuments, PeerEmbedder, PeerJudge
from .server import CurationServicer

log = logging.getLogger("knowcel_curation")


async def run() -> None:
    settings = load_settings(Settings, "curation-service")
    setup_logging(settings.log_level, settings.log_format)
    setup_tracing(settings.otel_endpoint, "curation-service")
    start_metrics_server(settings.metrics_port)
    await migrate(settings.database_url)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    store = SqlCurationStore(engine)
    nc = await connect(settings.nats_url, "curation-service")
    js = nc.jetstream()
    await ensure_stream(js, STREAM, ["knowcel.ingestion.>"])
    stop = asyncio.Event()
    scorer = Scorer(store, settings.weights)
    background: list[asyncio.Task[None]] = []
    try:
        # Soft dependencies: while document is down, scores and findings can't
        # be read (UNAVAILABLE); while it or llm is, new documents are checked
        # for findings later (their events are retried).
        async with (
            channel(settings.document_addr) as document_ch,
            channel(settings.llm_addr) as llm_ch,
        ):
            documents = PeerDocuments(document_pb2_grpc.DocumentServiceStub(document_ch))
            llm = llm_pb2_grpc.LlmServiceStub(llm_ch)
            detector = Detector(
                store, documents, PeerEmbedder(llm), PeerJudge(llm), scorer, settings.thresholds
            )
            background = [
                asyncio.create_task(consume(js, scorer, detector, stop)),
                asyncio.create_task(
                    rescore_periodically(scorer, settings.curation_rescore_interval, stop)
                ),
            ]
            servicer = CurationServicer(store, documents, scorer)
            await serve(
                settings.grpc_port,
                [lambda s: curation_pb2_grpc.add_CurationServiceServicer_to_server(servicer, s)],
                [curation_pb2.DESCRIPTOR.services_by_name["CurationService"].full_name],
            )
    finally:
        stop.set()
        for task in await asyncio.gather(*background, return_exceptions=True):
            if isinstance(task, Exception):
                log.error("a background task failed", exc_info=task)
        await nc.drain()
        await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
