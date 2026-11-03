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


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_jwt_secret_refuses_to_start(monkeypatch, value):
    monkeypatch.setenv("JWT_SECRET", value)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="JWT_SECRET is required"):
        get_settings()


def test_unset_jwt_secret_message(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="JWT_SECRET is required"):
        get_settings()


def test_normal_secret_works():
    assert get_settings().jwt_secret == "test-secret"


def test_token_signed_with_empty_key_rejected(session, client):
    from jose import jwt

    from api.models import User
    from api.security import hash_password

    u = User(email="a@x.com", password_hash=hash_password("password123"), role="admin")
    session.add(u)
    session.commit()
    forged = jwt.encode({"sub": str(u.id), "role": "admin", "exp": 4102444800}, "",
                        algorithm="HS256")
    r = client.get("/runs", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401 and isinstance(r.json()["detail"], str)


def test_unhandled_exception_returns_json_500(session):
    from fastapi.testclient import TestClient

    from api.main import create_app

    app = create_app()

    @app.get("/_boom")
    def boom():
        raise ValueError("secret detail")

    r = TestClient(app, raise_server_exceptions=False).get("/_boom")
    assert r.status_code == 500
    assert r.json() == {"detail": "Internal server error"}
