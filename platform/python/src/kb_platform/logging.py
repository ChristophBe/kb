import json
import logging
import sys
from datetime import UTC, datetime

from kb_platform.version import version


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def setup_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Configure the root logger and log the release version the component runs.

    JSON matches the Go services' slog output.
    """
    handler = logging.StreamHandler(sys.stderr)
    if fmt == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
    logging.getLogger("kb_platform").info("starting version %s", version())
