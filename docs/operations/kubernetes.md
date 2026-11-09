# Kubernetes

The Helm chart `deploy/helm/kb` deploys the whole stack: every module component, the Envoy gateway, the web shell and an Ingress. Why it looks the way it does: [ADR 0011](../adr/0011-helm-chart-generated-from-module-manifests.md).

By default it runs the [published images](images.md) of the release in the chart's `appVersion` and connects to **external** Postgres (with pgvector), NATS (with JetStream) and S3. `infra.enabled=true` instead deploys single-instance servers and the dev Dex in the release, for development and tests.

## What gets deployed

| Resource | Notes |
|---|---|
| One Deployment per module component (`document-service`, `ingestion-worker`, ...), a Service for each that serves gRPC | Names as in compose. Probes use `grpc.health.v1`; workers have none and are restarted when they exit. Every pod serves Prometheus metrics on its port `metrics` (also on the Service) and has the `prometheus.io/*` scrape annotations ([Metrics](../metrics.md)). |
| `envoy` Deployment, Service and ConfigMap | The generated `deploy/envoy/envoy.yaml` with the OIDC values filled in |
| `web` Deployment and Service | The web shell; `config.json` points the browser at `publicUrl` |
| Ingress `kb` | `ingress.host`: the gRPC service paths go to Envoy, `/` to the web shell (with `infra.enabled` also `/dex` to Dex, and the host `s3.<host>` to SeaweedFS) |
| NetworkPolicy `kb-modules` | Only the release's own pods reach the module services, which trust Envoy's `x-kb-user` header ([ADR 0009](../adr/0009-oidc-authentication-at-the-gateway.md)); the `metrics` port is open to any pod, so a Prometheus in another namespace can scrape it. Turn off with `networkPolicy.enabled=false`. |
| With `infra.enabled`: StatefulSets `postgres`, `nats`, `s3` (SeaweedFS), Deployment `dex`, Secret `kb-infra` | Dev credentials, one replica each, 1 GiB volumes (`infra.persistence`) |
| With `ollama.enabled`: Deployment `ollama`, a PVC and a Job pulling `ollama.models` | |

Resources are named without the release name, so install one release per namespace. Services apply their own database migrations at startup (as in compose); there is no migration Job, so keep `replicas: 1` for services with migrations unless you roll out new versions one pod at a time.

## Install a release

Every [release](releases.md) publishes the chart to GHCR as an OCI artifact, with chart version and `appVersion` both the release version, so it runs that release's [images](images.md) by default:

```sh
helm install kb oci://ghcr.io/christophbe/charts/kb --version <version> -n kb --create-namespace -f values.yaml
```

`helm show values oci://ghcr.io/christophbe/charts/kb --version <version>` prints the values it takes. The `chart` job of the `release` workflow packages `deploy/helm/kb` with `helm package --version <v> --app-version <v>` and pushes it with the workflow's `GITHUB_TOKEN`. The first push creates the package `charts/kb` as **private**; until a repository admin makes it public once (*github.com/ChristophBe → Packages → charts/kb → Package settings → Change visibility → Public*), installing needs `helm registry login ghcr.io` with a token that can read packages.

## Try it on kind

Needs [kind](https://kind.sigs.k8s.io/), `kubectl`, `helm` and Docker. An Ingress controller is required; the example uses Traefik on the node's port 80, published on the host as port 8000 (any free port works, as long as `publicUrl` uses it).

```sh
cat > /tmp/kind-kb.yaml <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - { containerPort: 80, hostPort: 8000, listenAddress: 127.0.0.1 }
EOF
kind create cluster --name kb --config /tmp/kind-kb.yaml
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n traefik --create-namespace \
  --set ports.web.hostPort=80 --set service.enabled=false --set ingressClass.isDefaultClass=true --wait
```

To try the chart of the checkout with its own code, build the images from it and load them into the cluster (every entry of `deploy/images.json`):

```sh
for c in document-service ingestion-service; do
  docker build -t ghcr.io/christophbe/kb-$c:dev -f deploy/docker/go.Dockerfile \
    --build-arg CMD=./modules/${c%-service}/service/cmd/$c .
done
for c in chat-service llm-service ingestion-worker; do
  docker build -t ghcr.io/christophbe/kb-$c:dev -f deploy/docker/python.Dockerfile --build-arg PACKAGE=kb-$c .
done
docker build -t ghcr.io/christophbe/kb-web:dev -f deploy/docker/web.Dockerfile .
for c in document-service ingestion-service chat-service llm-service ingestion-worker web; do
  kind load docker-image --name kb ghcr.io/christophbe/kb-$c:dev
done
```

Install with the dev infrastructure and the fake LLM provider (no models needed):

```sh
helm install kb deploy/helm/kb -n kb --create-namespace \
  --set infra.enabled=true \
  --set publicUrl=http://kb.localhost:8000 \
  --set image.tag=dev \
  --set components.llm-service.env.KB_LLM_PROVIDER=fake \
  --set components.chat-service.env.KB_RAG_MIN_SCORE=-1 \
  --wait --timeout 10m
```

Open <http://kb.localhost:8000> (browsers resolve `*.localhost` to your machine) and sign in as `alice@example.com` / `password`. For real models add `--set ollama.enabled=true` and drop the two `env` overrides; the first pull of the models takes a while (`kubectl -n kb logs job/ollama-pull-...`).

`kind delete cluster --name kb` removes everything.

## Production install

1. **Infrastructure.** Postgres 17 with the `vector` extension available (the document migrations create it), NATS with JetStream, and an S3 bucket service. Create the Secret with their credentials. Use URL-safe credentials: they are put into connection URLs as they are, and chat's migration tool doesn't accept `%`.

   ```sh
   kubectl -n kb create secret generic kb-infra \
     --from-literal=postgres-user=kb --from-literal=postgres-password=... \
     --from-literal=nats-url=nats://user:pass@nats.example.internal:4222 \
     --from-literal=s3-access-key=... --from-literal=s3-secret-key=...
   ```

2. **OIDC.** Register a public client (authorization code with PKCE) at your identity provider with the redirect URIs `<publicUrl>/` and `<publicUrl>/auth/callback`. Envoy needs the issuer and its JWKS URL.

3. **Values**, e.g. `values.prod.yaml`:

   ```yaml
   publicUrl: https://kb.example.com
   ingress:
     className: nginx
     host: kb.example.com
     tls: [{ secretName: kb-tls, hosts: [kb.example.com] }]
   postgres: { host: db.example.internal, sslmode: require }
   s3:
     endpoint: s3.eu-central-1.amazonaws.com
     publicEndpoint: s3.eu-central-1.amazonaws.com   # what browsers upload to
     region: eu-central-1
     bucket: kb-documents
   oidc:
     issuer: https://id.example.com
     jwksUrl: https://id.example.com/keys
     audiences: [kb-web]
   components:
     llm-service:
       env: { KB_LLM_PROVIDER: anthropic, KB_EMBEDDING_PROVIDER: ollama, KB_OLLAMA_URL: http://ollama.ml:11434 }
       extraEnv:
         - name: KB_ANTHROPIC_API_KEY
           valueFrom: { secretKeyRef: { name: kb-llm, key: anthropic-api-key } }
   ```

4. `helm install kb deploy/helm/kb -n kb -f values.prod.yaml --wait`

The browser uploads files straight to `s3.publicEndpoint` through presigned URLs, so it must be reachable from browsers and allow the web origin (CORS). `s3.useSSL` applies to both endpoints. Uploads don't pass the Ingress, but chat streams do: on controllers that buffer responses (ingress-nginx) add an annotation that turns proxy buffering off, or answers arrive in one piece.

## Configuration

`values.yaml` documents every value. The most common:

| Value | Default | |
|---|---|---|
| `publicUrl` | `http://kb.localhost` | Where browsers reach the Ingress; the API base URL and, with `infra.enabled`, the Dex issuer (`<publicUrl>/dex`) |
| `image.registry`, `image.tag` | `ghcr.io/christophbe`, the chart's `appVersion` | |
| `infra.enabled` | `false` | Dev Postgres, NATS, SeaweedFS and Dex in the release |
| `infra.secretName` | `kb-infra` | Secret with the infrastructure credentials |
| `postgres.*`, `s3.*` | | External servers |
| `oidc.issuer`, `oidc.jwksUrl`, `oidc.audiences`, `oidc.clientId` | | Required without `infra.enabled` |
| `ingress.enabled`, `.className`, `.host`, `.tls`, `.annotations` | | |
| `ollama.enabled`, `ollama.models` | `false` | Local model server, reachable as `http://ollama:11434` |
| `otel.endpoint` | empty | OTLP endpoint for every component (`KB_OTEL_ENDPOINT`); empty leaves tracing off |
| `components.<name>.enabled`, `.replicas`, `.resources` | | Per module component |
| `components.<name>.env` | from the module's manifest | `KB_*` settings (`.env.example`), e.g. `components.document-service.env.KB_MAX_UPLOAD_BYTES` |
| `components.<name>.extraEnv` | `[]` | Full `EnvVar` entries, e.g. from Secrets |

## How the chart is built

The module parts are generated by `task gen` (`tools/modgen`) from the `module.yaml` files; don't edit them:

- `templates/modules/<id>.yaml`: one per module, calling `kb.component` (`templates/_component.tpl`) for each component with its language, gRPC and metrics ports, infrastructure (`infra` in the manifest) and peer addresses (`KB_<MODULE>_ADDR` from `depends_on`)
- `values.yaml`: from `tools/modgen/templates/helm/values.yaml.tmpl`, with a `components` entry per component (defaults from the manifest's `env`)
- `templates/_modules.gen.tpl`: the gRPC path prefixes the Ingress sends to Envoy
- `files/envoy.yaml`: the same Envoy config compose uses

So a new module is in the chart after `task gen`; `task check-gen` fails when the committed chart is out of date. Everything else in `deploy/helm/kb` (infrastructure, Envoy, web, Ingress, helpers) is written by hand. `task lint` runs `helm lint` when Helm is installed.

CI's `helm` job lints the chart and installs it on kind as above (Traefik, `infra.enabled`, fake LLM provider) with the images the `images` job built in the same run (saved as artifacts and `kind load`ed), then runs the [end-to-end smoke test](../../tests/e2e) against the release through the Ingress (`KB_E2E_GATEWAY=http://kb.localhost:8000 task e2e`). A template that doesn't render or a release that doesn't come up fails it. To run the test against your own kind install, map `kb.localhost` and `s3.kb.localhost` to `127.0.0.1` in `/etc/hosts` if your resolver doesn't, and set `KB_E2E_GATEWAY` to the `publicUrl`.
