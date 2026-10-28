# 0003. gRPC between modules, gRPC-Web through Envoy

- Status: Accepted
- Date: 2026-10-28

## Context

Modules are written in Go and Python and consumed by a TypeScript UI. We need one typed contract per module that all three languages can use, supports server streaming (chat answers, job progress, file content), and can be checked for breaking changes.

## Decision

We will define every module API in protobuf (`modules/<id>/proto/kb/<id>/v1/`) and serve it over gRPC. Code for Go, Python and TypeScript is generated with buf. The browser reaches the services through Envoy (`deploy/envoy/envoy.yaml`, generated from the manifests), which translates gRPC-Web and handles CORS; the UI uses Connect's gRPC-Web transport (`platform/ui/module-sdk`). Services call each other directly over gRPC, not through Envoy.

## Consequences

- One contract for backend and frontend; `buf lint` and `buf breaking` run in CI.
- Envoy is the only browser-facing API endpoint; every routed service is listed in its module's `grpc_services`.
- Browser clients cannot use client or bidirectional streaming (gRPC-Web limitation); APIs used by the UI stick to unary and server streaming.
