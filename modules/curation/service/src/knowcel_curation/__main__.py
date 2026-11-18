import asyncio
import logging

from knowcel.curation.v1 import curation_pb2, curation_pb2_grpc
from knowcel_platform.config import load_settings
from knowcel_platform.grpc import serve
from knowcel_platform.logging import setup_logging
from knowcel_platform.metrics import start_metrics_server
from knowcel_platform.telemetry import setup_tracing
from sqlalchemy.ext.asyncio import create_async_engine

from .config import Settings
from .db import SqlCurationStore, migrate
from .server import CurationServicer

log = logging.getLogger("knowcel_curation")


async def run() -> None:
    settings = load_settings(Settings, "curation-service")
    setup_logging(settings.log_level, settings.log_format)
    setup_tracing(settings.otel_endpoint, "curation-service")
    start_metrics_server(settings.metrics_port)
    await migrate(settings.database_url)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    servicer = CurationServicer(SqlCurationStore(engine))
    try:
        await serve(
            settings.grpc_port,
            [lambda s: curation_pb2_grpc.add_CurationServiceServicer_to_server(servicer, s)],
            [curation_pb2.DESCRIPTOR.services_by_name["CurationService"].full_name],
        )
    finally:
        await engine.dispose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
