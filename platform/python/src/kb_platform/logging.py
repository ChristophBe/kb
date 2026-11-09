import json
import logging
import sys
from datetime import UTC, datetime

from opentelemetry import trace

from kb_platform.version import version


class _TraceFilter(logging.Filter):
    """Puts the trace and span id of the current span, if any, on each record
    as `trace_id` and `span_id` (empty strings outside a span)."""

    def filter(self, record: logging.LogRecord) -> bool:
        ctx = trace.get_current_span().get_span_context()
        if ctx.is_valid:
            record.trace_id = trace.format_trace_id(ctx.trace_id)
            record.span_id = trace.format_span_id(ctx.span_id)
        else:
            record.trace_id = record.span_id = ""
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if trace_id := getattr(record, "trace_id", ""):
            entry["trace_id"] = trace_id
            entry["span_id"] = getattr(record, "span_id", "")
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry)


class _TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        if trace_id := getattr(record, "trace_id", ""):
            line += f" trace_id={trace_id} span_id={getattr(record, 'span_id', '')}"
        return line


def setup_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Configure the root logger and log the release version the component runs.

    JSON matches the Go services' slog output. Records logged inside a span
    carry its trace_id and span_id.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.addFilter(_TraceFilter())
    if fmt == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(_TextFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
    logging.getLogger("kb_platform").info("starting version %s", version())
