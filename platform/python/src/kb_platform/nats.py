import nats
from nats.aio.client import Client
from nats.js import JetStreamContext
from nats.js.api import StreamConfig
from nats.js.errors import NotFoundError


async def connect(url: str, name: str) -> Client:
    return await nats.connect(url, name=name, max_reconnect_attempts=-1)


async def ensure_stream(js: JetStreamContext, name: str, subjects: list[str]) -> None:
    """Create the stream if missing. Streams are owned by the module whose
    subjects they carry; any of its components may call this at startup."""
    try:
        await js.stream_info(name)
    except NotFoundError:
        await js.add_stream(StreamConfig(name=name, subjects=subjects))
