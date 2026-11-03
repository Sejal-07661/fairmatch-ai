import pytest

from api.config import get_settings


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_missing_jwt_secret_refuses_to_start(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError):
        get_settings()


def test_settings_defaults():
    assert get_settings().access_token_minutes == 60
