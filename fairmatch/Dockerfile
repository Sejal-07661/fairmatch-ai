# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY requirements.txt .
# CPU-only torch keeps the image small; other packages still resolve from PyPI.
RUN pip wheel --wheel-dir /wheels --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HF_HOME=/opt/hf PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=bind,from=builder,source=/wheels,target=/wheels \
    pip install --no-index --find-links /wheels -r requirements.txt

COPY api ./api
COPY core ./core
COPY migrations ./migrations
COPY scripts ./scripts
COPY sample_data ./sample_data
COPY alembic.ini openapi.json ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Download the embedding model as root, then hand everything to the app user.
RUN python scripts/prefetch_model.py \
    && sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod 755 /usr/local/bin/entrypoint.sh \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /opt/hf /app

USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
