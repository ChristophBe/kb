# Shared image for Go services. Build from the repository root with
#   --build-arg CMD=./modules/<id>/service/cmd/<name> [--build-arg KNOWCEL_VERSION=<x.y.z>]
# The build stage runs on the build machine and cross-compiles for the target
# platform (multi-arch release builds, docs/operations/images.md).
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY platform/go platform/go
COPY platform/api/go platform/api/go
COPY modules modules
ARG CMD TARGETOS TARGETARCH
# The release version, logged at startup (platform/go/version); "dev" for local builds.
ARG KNOWCEL_VERSION=dev
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags="-s -w -X github.com/ChristophBe/knowcelium/platform/go/version.Version=${KNOWCEL_VERSION}" \
    -o /out/app ${CMD}

FROM gcr.io/distroless/static-debian12:nonroot
ARG KNOWCEL_VERSION=dev
LABEL org.opencontainers.image.version=${KNOWCEL_VERSION}
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
