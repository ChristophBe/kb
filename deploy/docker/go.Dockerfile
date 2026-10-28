# Shared image for Go services. Build from the repository root with
#   --build-arg CMD=./modules/<id>/service/cmd/<name>
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY platform/go platform/go
COPY platform/api/go platform/api/go
COPY modules modules
ARG CMD
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ${CMD}

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
