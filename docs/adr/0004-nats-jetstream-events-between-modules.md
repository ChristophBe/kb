# 0004. NATS JetStream for events between modules

- Status: Accepted
- Date: 2026-10-28

## Context

Document processing (extract → chunk → embed) is slow and must survive restarts, so the ingestion service cannot do it inside the upload RPC. Modules also need to react to each other's state changes without synchronous coupling.

## Decision

We will publish module events on NATS JetStream. Each module owns its stream (ingestion: `INGESTION`, subjects `kb.<id>.<event>`), and the event payloads are protobuf messages defined in the module's proto package (`modules/ingestion/proto/kb/ingestion/v1/events.proto`). Publishers set a message ID so retries are deduplicated; consumers are durable and acknowledge after processing.

## Consequences

- Events are part of a module's public contract and follow the same compatibility rules as its RPCs.
- Work queues (the ingestion worker) get persistence and redelivery for free.
- NATS is required infrastructure; consumers must be idempotent because delivery is at-least-once.
