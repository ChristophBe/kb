import asyncio
import contextlib
import logging

from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel.document.v1 import document_pb2_grpc
from knowcel_platform.config import load_settings
from knowcel_platform.grpc import channel, serve
from knowcel_platform.logging import setup_logging
from knowcel_platform.metrics import start_metrics_server
from knowcel_platform.nats import connect, ensure_stream
from knowcel_platform.telemetry import setup_tracing
from sqlalchemy.ext.asyncio import create_async_engine

from .config import Settings
from .curation import Scorer
from .db import SqlCurationStore, migrate
from .events import STREAM, consume
from .peers import PeerDocuments
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
    consumer = asyncio.create_task(consume(js, Scorer(store, settings.weights), stop))
    try:
        # Soft dependency: while document is down, scores can't be read
        # (UNAVAILABLE); scoring processed documents doesn't need it.
        async with channel(settings.document_addr) as document_ch:
            servicer = CurationServicer(
                store, PeerDocuments(document_pb2_grpc.DocumentServiceStub(document_ch))
            )
            await serve(
                settings.grpc_port,
                [lambda s: curation_pb2_grpc.add_CurationServiceServicer_to_server(servicer, s)],
                [curation_pb2.DESCRIPTOR.services_by_name["CurationService"].full_name],
            )
    finally:
        stop.set()
        with contextlib.suppress(asyncio.CancelledError):
            await consumer
        await nc.drain()
        await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
