import pytest
from fastapi.testclient import TestClient

from api.config import get_settings
from api.main import create_app


@pytest.fixture(autouse=True)
def settings_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("CELERY_EAGER", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(create_app())
