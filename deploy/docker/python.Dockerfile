# Shared image for Python components. Build from the repository root with
#   --build-arg PACKAGE=<workspace package with a console script of the same name>
FROM python:3.13-slim
RUN pip install --no-cache-dir uv==0.11.14
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1
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
ENV KB_ENTRYPOINT=${PACKAGE}
USER nobody
CMD ["sh", "-c", "exec ${KB_ENTRYPOINT}"]
