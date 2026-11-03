import os

import pytest
from fastapi.testclient import TestClient

from api.config import get_settings
from api.db import reset_engine_cache
from api.main import create_app
from api.worker import configure_celery


@pytest.fixture(autouse=True)
def settings_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CELERY_EAGER", "true")
    monkeypatch.setenv("REDIS_URL", "fakeredis://")
    get_settings.cache_clear()
    reset_engine_cache()
    configure_celery()
    yield
    reset_engine_cache()
    get_settings.cache_clear()


@pytest.fixture
def client(session):
    return TestClient(create_app())


def pytest_collection_modifyitems(config, items):
    if os.environ.get("TEST_DATABASE_URL"):
        return
    skip = pytest.mark.skip(
        reason="set TEST_DATABASE_URL (start Postgres with "
        "`docker compose -f docker-compose.dev.yml up -d`)"
    )
    for item in items:
        if item.get_closest_marker("db"):
            item.add_marker(skip)


@pytest.fixture
def session():
    from api import models  # noqa: F401  (register tables)
    from api.db import Base, SessionLocal, get_engine

    Base.metadata.create_all(get_engine())
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


class _FakeEmbedder384:
    dim = 384

    def encode(self, texts: list[str]):
        import re
        import zlib

        import numpy as np

        out = np.zeros((len(texts), self.dim), dtype=float)
        for i, t in enumerate(texts):
            for w in re.findall(r"\w+", t.lower()):
                out[i, zlib.crc32(w.encode("utf-8")) % self.dim] += 1.0
            n = np.linalg.norm(out[i])
            if n > 0:
                out[i] /= n
        return out


@pytest.fixture
def fake_embedder_384():
    return _FakeEmbedder384()
