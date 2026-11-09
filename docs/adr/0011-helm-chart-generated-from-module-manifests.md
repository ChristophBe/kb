# 0011. Deploy to Kubernetes with one Helm chart generated from the module manifests

- Status: Accepted
- Date: 2026-11-08

## Context

kb runs only with docker compose. Operators who run Kubernetes need a supported way to deploy it (#165). Constraints:

- The wiring between modules is generated from `module.yaml` (compose includes, Envoy routes, images). A Kubernetes deployment that is maintained by hand drifts as soon as a module is added.
- The stack needs Postgres with pgvector, NATS JetStream and an S3 service. Production installs use managed or separately operated servers; development and tests want everything in one install.
- Bitnami's Postgres/NATS/MinIO subcharts used to be the default answer for bundled infrastructure, but their image distribution changed in 2025 (free images moved to a legacy repository without updates), so depending on them ties the chart to images that no longer get fixes.

Options considered: plain manifests with Kustomize overlays (no templating of per-module wiring without a generator anyway, no packaging), one chart per module plus an umbrella chart (more release mechanics, and peers would need cross-chart naming conventions), and one chart for the whole stack.

## Decision

We will ship one Helm chart, `deploy/helm/kb`, for the whole stack.

- `tools/modgen` generates the module-specific parts (`task gen`): one template per module (`templates/modules/<id>.yaml`), `values.yaml` with an entry per component, the gateway path prefixes for the Ingress (`templates/_modules.gen.tpl`) and a copy of the generated Envoy config (`files/envoy.yaml`). The manifests say which infrastructure a component uses (`infra`) and which deployment settings it needs (`env`); peer addresses (`KB_<MODULE>_ADDR`) follow from `depends_on`. Everything else in the chart is hand-written; the generated templates only call `kb.component` with the manifest's facts.
- Resources keep the compose service names (`document-service`, `envoy`, ...), so the generated Envoy config and the peer addresses are the same in both. As a consequence there is one release per namespace.
- Postgres, NATS and S3 are external by default, configured through values and one Secret. `infra.enabled=true` deploys single-instance Postgres (pgvector), NATS, SeaweedFS and the dev Dex in the release, written directly in the chart, without subcharts. It is for development and tests.
- Services keep applying their own migrations at startup (goose, Alembic), as in compose; there is no migration Job.
- Envoy's OIDC placeholders are filled in by Helm from values instead of by `deploy/envoy/entrypoint.sh`.

## Consequences

- Adding a module and running `task gen` adds its components to the chart; `task check-gen` catches a chart that is out of date, and the modgen golden tests cover the generated parts.
- The chart's dev infrastructure has no high availability, backups or tuning. Production needs external servers.
- Migrations at startup assume one replica migrates at a time; with several replicas of a service, the first rollout of a new migration may race (goose and Alembic don't lock across pods). Revisit with a migration Job or advisory locks when a service needs more than one replica.
- Publishing the chart and setting its versions from the release (`needs.release.outputs.version`) is #166.
