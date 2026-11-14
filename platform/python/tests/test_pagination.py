import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from knowcel_platform.pagination import Cursor, InvalidCursorError, decode_cursor

# The Go tests read the same file, so the two encodings cannot drift.
FIXTURE = json.loads((Path(__file__).parents[2] / "testdata" / "cursor.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["valid"])
def test_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    cursor = decode_cursor(case["token"])
    assert cursor.id == uuid.UUID(case["id"])
    assert cursor.time == datetime(1970, 1, 1, tzinfo=UTC) + timedelta(
        microseconds=case["unix_micros"]
    )
    assert cursor.encode() == case["token"]


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda c: c["name"])
def test_rejects_invalid_tokens(case: dict[str, Any]) -> None:
    with pytest.raises(InvalidCursorError):
        decode_cursor(case["token"])


def test_round_trips_other_timezones() -> None:
    cursor = Cursor(datetime(2026, 11, 14, 9, 30, 1, 5, tzinfo=UTC), uuid.uuid4())
    assert decode_cursor(cursor.encode()) == cursor
