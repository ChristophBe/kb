"""Opaque keyset page tokens for lists ordered by (time DESC, id DESC).

The wire format is shared with the Go helper (platform/go/postgres/cursor.go),
and both are tested against platform/testdata/cursor.json: base64url without
padding of the compact JSON {"v":1,"t":<unix microseconds>,"i":"<uuid>"}.
"""

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

_VERSION = 1
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECOND = timedelta(microseconds=1)


class InvalidCursorError(ValueError):
    """A page token that is malformed, was not made by `Cursor.encode` or has
    an unknown version."""


@dataclass(frozen=True)
class Cursor:
    """The position after which a list continues: the ordering time and the id
    of the last row of the previous page."""

    time: datetime
    id: uuid.UUID

    def encode(self) -> str:
        micros = (self.time.astimezone(UTC) - _EPOCH) // _MICROSECOND
        raw = json.dumps({"v": _VERSION, "t": micros, "i": str(self.id)}, separators=(",", ":"))
        return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def decode_cursor(token: str) -> Cursor:
    """Parses a token made by `Cursor.encode`; anything else raises
    `InvalidCursorError`."""
    try:
        padded = token + "=" * (-len(token) % 4)
        data = json.loads(base64.b64decode(padded, altchars=b"-_", validate=True))
        if data["v"] != _VERSION or type(data["t"]) is not int:
            raise InvalidCursorError(token)
        return Cursor(time=_EPOCH + data["t"] * _MICROSECOND, id=uuid.UUID(data["i"]))
    except (ValueError, KeyError, TypeError, binascii.Error, OverflowError) as err:
        raise InvalidCursorError(token) from err
