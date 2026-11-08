# Container images

Every [release](releases.md) publishes one image per component to the GitHub Container Registry, for `linux/amd64` and `linux/arm64`:

| Component | Image |
|---|---|
| `document-service` | `ghcr.io/christophbe/kb-document-service` |
| `ingestion-service` | `ghcr.io/christophbe/kb-ingestion-service` |
| `ingestion-worker` | `ghcr.io/christophbe/kb-ingestion-worker` |
| `chat-service` | `ghcr.io/christophbe/kb-chat-service` |
| `llm-service` | `ghcr.io/christophbe/kb-llm-service` |
| `web` | `ghcr.io/christophbe/kb-web` |

Each is tagged with the version without the `v` (`0.3.1`) and, for the newest release, `latest`. The images carry the version as label `org.opencontainers.image.version` and log it at startup.

The project will be renamed to *Knowcelium* (milestone *Rebrand*); the image names change with it. Until then they keep the `kb-` prefix.

## Running a release

`deploy/release.compose.yaml` swaps every component's build for its published image. Run it from a checkout of the release tag, since the infrastructure configuration (Envoy, Dex, SeaweedFS) is still read from `deploy/`:

```sh
git checkout v0.3.1
KB_VERSION=0.3.1 docker compose -f compose.yaml -f deploy/release.compose.yaml up -d
```

Nothing is built; compose pulls the images it doesn't have yet. Without `KB_VERSION` compose stops with *set KB_VERSION to a released version*. All other settings (`.env.example`, README) work as with `task up`, e.g. `--profile ollama` or `KB_LLM_PROVIDER=fake`. `docker compose ... pull` fetches the images up front.

While the packages are private, sign in first with a personal access token (classic) that has `read:packages`: `echo "$TOKEN" | docker login ghcr.io -u <github user> --password-stdin`.

## How images are built

The component list is generated: `task gen` (`tools/modgen`) writes `deploy/images.json` from the module manifests, one entry per service in a `module.yaml` plus the web shell, with its Dockerfile and build args. A new module's components are published without touching a workflow. `deploy/release.compose.yaml` is generated from the same list.

- [`images.yml`](../../.github/workflows/images.yml) builds every entry of `deploy/images.json` with Buildx, one job per component, with a GitHub Actions cache per component. Go images cross-compile on the runner (`--platform=$BUILDPLATFORM` in `go.Dockerfile`); Python and web images build arm64 under QEMU.
- `ci.yml` calls it on every PR and `main` push for `linux/amd64` without pushing, so a Dockerfile or manifest change that breaks an image fails the PR. Its `main` builds fill the cache the release builds reuse.
- `release.yml` calls it after the `release` job when a version was released, for both platforms, pushing `<version>` and `latest`. It is a job in the release run rather than a workflow triggered by the tag: it gets the version from the `release` job output, pushes with `GITHUB_TOKEN` (`packages: write`), and the release run's concurrency group keeps two quick releases in order, so `latest` ends up on the newest.

To republish a released version (e.g. after a failed image job), re-run the failed `images` jobs of its release run, or run the workflow by hand; it checks out tag `v<version>` and pushes both platforms:

```sh
gh workflow run images.yml -f version=0.3.1             # leaves latest alone
gh workflow run images.yml -f version=0.3.1 -f latest=true
```

## Package settings

The first push creates each package as **private**, linked to this repository (label `org.opencontainers.image.source`), so the workflow's `GITHUB_TOKEN` can keep pushing to it. To let anyone pull without signing in, a repository admin makes each package public once: *github.com/ChristophBe → Packages → kb-<component> → Package settings → Change visibility → Public*.
