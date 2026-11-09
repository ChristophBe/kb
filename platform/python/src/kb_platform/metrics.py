"""Prometheus metrics. `start_metrics_server` serves the process's metrics at
/metrics on their own port (KB_METRICS_PORT), apart from the gRPC port, so
scraping needs no gRPC and no token. Metrics register with prometheus_client's
default registry, which also carries the process and Python runtime
collectors. Names and labels are listed in docs/metrics.md; labels never
carry user or document ids.

The gRPC server metrics below are recorded by `kb_platform.grpc.serve`, with
the same names and labels as the Go services (platform/go/grpcserver)."""

from __future__ import annotations

import logging

from prometheus_client import Counter, Histogram, disable_created_metrics, start_http_server

log = logging.getLogger(__name__)

# Counters and histograms without the extra *_created series, as in Go.
disable_created_metrics()

PATH = "/metrics"

GRPC_HANDLED = Counter(
    "grpc_server_handled",
    "RPCs completed by the server, by method and status code.",
    ["grpc_type", "grpc_service", "grpc_method", "grpc_code"],
)
GRPC_HANDLING_SECONDS = Histogram(
    "grpc_server_handling_seconds",
    "Time the server took to complete an RPC, streams included.",
    ["grpc_type", "grpc_service", "grpc_method"],
    # Up to the minutes a streamed answer from a local model can take.
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300),
)


def start_metrics_server(port: int) -> None:
    """Serves the metrics on `port` from a background thread for the rest of
    the process's life. Binding happens before it returns, so a port in use
    fails the component at startup. prometheus_client answers on every path;
    scrape /metrics."""
    start_http_server(port)
    log.info("metrics server listening on :%d%s", port, PATH)
