import asyncio
import logging

from kb.llm.v1 import llm_pb2, llm_pb2_grpc
from kb_platform.grpc import serve
from kb_platform.logging import setup_logging
from kb_platform.telemetry import setup_tracing

from .config import Settings
from .providers import build_providers
from .server import LlmServicer

log = logging.getLogger("kb_llm")


async def run() -> None:
    settings = Settings()
    setup_logging(settings.log_level, settings.log_format)
    setup_tracing(settings.otel_endpoint, "llm-service")
    try:
        providers = build_providers(settings)
    except ValueError as exc:  # misconfiguration, e.g. a missing API key
        log.error("cannot start: %s", exc)
        raise SystemExit(1) from None
    log.info(
        "using provider %s for chat and %s for embeddings",
        providers.chat.name,
        providers.embedding.name,
    )
    servicer = LlmServicer(providers, settings)
    try:
        await serve(
            settings.grpc_port,
            [lambda s: llm_pb2_grpc.add_LlmServiceServicer_to_server(servicer, s)],
            [llm_pb2.DESCRIPTOR.services_by_name["LlmService"].full_name],
        )
    finally:
        await providers.aclose()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
