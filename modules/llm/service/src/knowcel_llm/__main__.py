import asyncio
import logging

from knowcel.iam.v1 import iam_pb2_grpc
from knowcel.llm.v1 import llm_pb2, llm_pb2_grpc
from knowcel_platform.config import ConfigError, load_settings
from knowcel_platform.grpc import PrincipalResolver, channel, serve
from knowcel_platform.logging import setup_logging
from knowcel_platform.metrics import start_metrics_server
from knowcel_platform.telemetry import setup_tracing

from .callers import resolver
from .config import Settings
from .providers import build_providers
from .server import LlmServicer

log = logging.getLogger("knowcel_llm")


async def run() -> None:
    settings = load_settings(Settings, "llm-service")
    setup_logging(settings.log_level, settings.log_format)
    setup_tracing(settings.otel_endpoint, "llm-service")
    start_metrics_server(settings.metrics_port)
    try:
        providers = build_providers(settings)
    except ValueError as exc:  # e.g. a provider without the task it is chosen for
        raise ConfigError("llm-service", [str(exc)]) from None
    log.info(
        "using provider %s for chat and %s for embeddings",
        providers.chat.name,
        providers.embedding.name,
    )
    servicer = LlmServicer(providers, settings)
    try:
        # Soft dependency: while iam is down nobody is a platform admin, so
        # models can't be changed; everything else works.
        async with channel(settings.iam_addr) as iam_ch:
            iam = iam_pb2_grpc.IamServiceStub(iam_ch)
            await serve(
                settings.grpc_port,
                [lambda s: llm_pb2_grpc.add_LlmServiceServicer_to_server(servicer, s)],
                [llm_pb2.DESCRIPTOR.services_by_name["LlmService"].full_name],
                principals=PrincipalResolver(resolver(iam)),
            )
    finally:
        await providers.aclose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
