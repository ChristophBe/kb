# Shared image for Python components. Build from the repository root with
#   --build-arg PACKAGE=<workspace package with a console script of the same name>
#   [--build-arg KNOWCEL_VERSION=<x.y.z>]
FROM python:3.13-slim
RUN pip install --no-cache-dir uv==0.11.14
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1
ARG PACKAGE
# The ingestion worker's optional OCR (KNOWCEL_OCR_ENABLED) calls the tesseract binary.
RUN if [ "${PACKAGE}" = knowcel-ingestion-worker ]; then \
      apt-get update && apt-get install -y --no-install-recommends tesseract-ocr \
      && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
COPY platform/python platform/python
COPY platform/api/python platform/api/python
COPY modules modules
ARG PACKAGE
RUN uv sync --frozen --no-dev --package ${PACKAGE}
# The chat answers how-to questions from the user manual. After the sync, so a
# manual change doesn't reinstall the dependencies.
COPY docs/user-manual docs/user-manual
ENV KNOWCEL_ENTRYPOINT=${PACKAGE}
# The release version, logged at startup (knowcel_platform.version); "dev" for local
# builds. Last, so a new version reuses every layer above.
ARG KNOWCEL_VERSION=dev
ENV KNOWCEL_VERSION=${KNOWCEL_VERSION}
LABEL org.opencontainers.image.version=${KNOWCEL_VERSION}
USER nobody
CMD ["sh", "-c", "exec ${KNOWCEL_ENTRYPOINT}"]
