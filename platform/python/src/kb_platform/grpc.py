import asyncio
import logging
import signal
from collections.abc import Callable, Iterable

import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_reflection.v1alpha import reflection

log = logging.getLogger(__name__)

Registrar = Callable[[grpc.aio.Server], None]


async def serve(
    port: int,
    register: Iterable[Registrar],
    service_names: Iterable[str],
    *,
    grace_seconds: float = 5.0,
) -> None:
    """Run a grpc.aio server with health checking and reflection until SIGINT
    or SIGTERM. `service_names` are the fully qualified names reported as
    SERVING and exposed via reflection."""
    server = grpc.aio.server()
    for reg in register:
        reg(server)

    names = list(service_names)
    health_servicer = health.aio.HealthServicer()  # pyright: ignore[reportAttributeAccessIssue]
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    for name in [*names, ""]:
        await health_servicer.set(name, health_pb2.HealthCheckResponse.SERVING)
    reflection.enable_server_reflection(
        [*names, health.SERVICE_NAME, reflection.SERVICE_NAME], server
    )

    server.add_insecure_port(f"[::]:{port}")
    await server.start()
    log.info("grpc server listening on :%d", port)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()

    log.info("shutting down")
    for name in [*names, ""]:
        await health_servicer.set(name, health_pb2.HealthCheckResponse.NOT_SERVING)
    await server.stop(grace_seconds)


def channel(target: str) -> grpc.aio.Channel:
    """Open an insecure channel to another module's service."""
    return grpc.aio.insecure_channel(target)
