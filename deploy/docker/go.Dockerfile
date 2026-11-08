# Shared image for Go services. Build from the repository root with
#   --build-arg CMD=./modules/<id>/service/cmd/<name> [--build-arg KB_VERSION=<x.y.z>]
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY platform/go platform/go
COPY platform/api/go platform/api/go
COPY modules modules
ARG CMD
# The release version, logged at startup (platform/go/version); "dev" for local builds.
ARG KB_VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X github.com/christoph/kb/platform/go/version.Version=${KB_VERSION}" \
    -o /out/app ${CMD}

FROM gcr.io/distroless/static-debian12:nonroot
ARG KB_VERSION=dev
LABEL org.opencontainers.image.version=${KB_VERSION}
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
