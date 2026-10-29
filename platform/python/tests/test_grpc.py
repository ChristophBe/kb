import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from kb_platform.grpc import is_serving


async def test_is_serving_reports_health_status() -> None:
    server = grpc.aio.server()
    servicer = health.aio.HealthServicer()  # pyright: ignore[reportAttributeAccessIssue]
    health_pb2_grpc.add_HealthServicer_to_server(servicer, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as ch:
        await servicer.set("", health_pb2.HealthCheckResponse.SERVING)
        assert await is_serving(ch)
        await servicer.set("", health_pb2.HealthCheckResponse.NOT_SERVING)
        assert not await is_serving(ch)
    await server.stop(None)


async def test_is_serving_is_false_when_unreachable() -> None:
    # Port 9 (discard) has no gRPC server; the call fails fast.
    async with grpc.aio.insecure_channel("127.0.0.1:9") as ch:
        assert not await is_serving(ch, rpc_timeout=0.5)
