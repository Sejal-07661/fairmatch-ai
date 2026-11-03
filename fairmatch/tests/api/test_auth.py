import base64
import json
from typing import Annotated

import pytest
from fastapi import Depends
from jose import jwt
from sqlalchemy import select

from api.config import get_settings
from api.models import User

CREDS = {"email": "a@example.com", "password": "password123"}


def _login(client, email="a@example.com", password="password123"):
    return client.post("/auth/login", data={"username": email, "password": password})


def _seed(session, email="u@example.com", password="password123", role="candidate"):
    from api.security import hash_password

    u = User(email=email, password_hash=hash_password(password), role=role)
    session.add(u)
    session.commit()
    return u


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _me_route(client):
    from api.deps import get_current_user

    def me(user: Annotated[User, Depends(get_current_user)]):
        return {"id": user.id, "role": user.role}

    client.app.add_api_route("/_me", me, methods=["GET"])


def _admin_route(client):
    from api.deps import require_role

    def admin_only(user: Annotated[User, Depends(require_role("admin"))]):
        return {"ok": True}

    client.app.add_api_route("/_admin", admin_only, methods=["GET"])


def test_register_then_login_returns_token(client):
    r = client.post("/auth/register", json=CREDS)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "a@example.com" and body["role"] == "candidate"
    assert "password" not in body and "password_hash" not in body
    r = _login(client)
    assert r.status_code == 200
    assert r.json()["token_type"] == "bearer"
    claims = jwt.decode(r.json()["access_token"], "test-secret", algorithms=["HS256"])
    assert claims["sub"] == str(body["id"]) and claims["role"] == "candidate"


def test_register_duplicate_email_409(client):
    assert client.post("/auth/register", json=CREDS).status_code == 201
    r = client.post("/auth/register", json={**CREDS, "email": "A@Example.com"})
    assert r.status_code == 409
    assert isinstance(r.json()["detail"], str)
    # the API stays healthy afterwards
    other = {**CREDS, "email": "b@example.com"}
    assert client.post("/auth/register", json=other).status_code == 201


def test_short_password_422(client):
    r = client.post("/auth/register", json={**CREDS, "password": "short"})
    assert r.status_code == 422


def test_password_over_72_bytes_422(client):
    assert client.post("/auth/register", json={**CREDS, "password": "a" * 73}).status_code == 422
    # multibyte: 37 x 2 bytes = 74 bytes
    assert client.post("/auth/register", json={**CREDS, "password": "é" * 37}).status_code == 422
    assert client.post("/auth/register", json={**CREDS, "password": "a" * 72}).status_code == 201


@pytest.mark.parametrize("email", ["", "   "])
def test_blank_email_422(client, email):
    assert client.post("/auth/register", json={**CREDS, "email": email}).status_code == 422


def test_login_is_case_insensitive_on_email(client):
    client.post("/auth/register", json={**CREDS, "email": "  MiXed@Example.com "})
    assert _login(client, "mixed@example.com").status_code == 200
    assert _login(client, "MIXED@EXAMPLE.COM").status_code == 200


def test_login_unknown_email_and_wrong_password_same_401_message(client):
    client.post("/auth/register", json=CREDS)
    wrong = _login(client, password="wrongpassword")
    unknown = _login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid credentials"}


def test_unknown_email_still_verifies_against_dummy_hash(client, monkeypatch):
    import api.routers.auth as auth_mod

    calls = []
    real = auth_mod.verify_password
    monkeypatch.setattr(auth_mod, "verify_password", lambda p, h: calls.append(h) or real(p, h))
    _login(client, email="nobody@example.com")
    assert len(calls) == 1


def test_expired_token_401(client, monkeypatch):
    from api.security import create_access_token

    monkeypatch.setenv("ACCESS_TOKEN_MINUTES", "-5")
    get_settings.cache_clear()
    token = create_access_token(1, "candidate")
    monkeypatch.delenv("ACCESS_TOKEN_MINUTES")
    get_settings.cache_clear()
    _me_route(client)
    assert client.get("/_me", headers=_hdr(token)).status_code == 401


def test_wrong_secret_token_401(client):
    token = jwt.encode({"sub": "1", "role": "admin", "exp": 9999999999}, "other", algorithm="HS256")
    _me_route(client)
    assert client.get("/_me", headers=_hdr(token)).status_code == 401


def test_other_algorithm_and_none_alg_tokens_401(client, session):
    u = _seed(session)
    claims = {"sub": str(u.id), "role": "candidate", "exp": 9999999999}
    hs512 = jwt.encode(claims, "test-secret", algorithm="HS512")

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    none_tok = b64({"alg": "none", "typ": "JWT"}) + "." + b64(claims) + "."
    _me_route(client)
    assert client.get("/_me", headers=_hdr(hs512)).status_code == 401
    assert client.get("/_me", headers=_hdr(none_tok)).status_code == 401


def test_malformed_token_401(client):
    _me_route(client)
    assert client.get("/_me", headers=_hdr("not.a.jwt")).status_code == 401
    assert client.get("/_me").status_code == 401


def test_token_for_deleted_user_401(client):
    from api.security import create_access_token

    _me_route(client)
    assert client.get("/_me", headers=_hdr(create_access_token(9999, "admin"))).status_code == 401


def test_db_role_is_authoritative_over_token_role(client, session):
    """The role claim in the token is ignored; the database role decides."""
    from api.security import create_access_token

    u = _seed(session, role="candidate")
    _admin_route(client)
    forged_admin = create_access_token(u.id, "admin")
    assert client.get("/_admin", headers=_hdr(forged_admin)).status_code == 403
    u.role = "admin"
    session.commit()
    stale_candidate = create_access_token(u.id, "candidate")
    assert client.get("/_admin", headers=_hdr(stale_candidate)).status_code == 200


def test_candidate_cannot_use_admin_dependency_403(client, session):
    _admin_route(client)
    _seed(session, "cand@example.com", role="candidate")
    _seed(session, "adm@example.com", role="admin")
    cand = _login(client, "cand@example.com").json()["access_token"]
    adm = _login(client, "adm@example.com").json()["access_token"]
    assert client.get("/_admin", headers=_hdr(cand)).status_code == 403
    assert client.get("/_admin", headers=_hdr(adm)).status_code == 200


def test_password_hash_not_plaintext_and_verifies():
    from api.security import hash_password, verify_password

    h = hash_password("password123")
    assert h != "password123"
    assert verify_password("password123", h)
    assert not verify_password("nope", h)
    assert not verify_password("password123", "garbage")


def test_cli_create_admin_creates_and_promotes(session):
    from api.cli import create_admin

    a = create_admin(session, "Boss@Example.com", "password123")
    assert a.role == "admin" and a.email == "boss@example.com"
    u = _seed(session, "cand@example.com")
    p = create_admin(session, "cand@example.com", "newpassword1")
    assert p.id == u.id and p.role == "admin"
    assert len(session.scalars(select(User)).all()) == 2


def test_cli_main_creates_admin_and_prints_id(session, capsys):
    from api.cli import main

    assert main(["create-admin", "root@example.com", "password123"]) == 0
    out = capsys.readouterr().out.strip()
    assert out.isdigit()
    session.expire_all()
    found = session.scalars(select(User).where(User.email == "root@example.com")).one()
    assert found.role == "admin"


def test_register_nul_and_overlong_email(client):
    pw = "password123"
    assert (
        client.post("/auth/register", json={"email": "a\x00b@x.com", "password": pw}).status_code
        == 422
    )
    long_local = "a" * (321 - len("@x.com"))
    assert (
        client.post(
            "/auth/register", json={"email": long_local + "@x.com", "password": pw}
        ).status_code
        == 422
    )
    ok = "a" * (320 - len("@x.com")) + "@x.com"
    assert len(ok) == 320
    assert client.post("/auth/register", json={"email": ok, "password": pw}).status_code == 201


def test_login_nul_or_overlong_username_401_without_db_query(client):
    from sqlalchemy import event

    from api.db import get_engine

    unknown = _login(client, email="nobody@example.com")
    stmts = []

    def spy(conn, cursor, statement, *a):
        stmts.append(statement)

    event.listen(get_engine(), "before_cursor_execute", spy)
    try:
        for name in ("a\x00b@x.com", "a" * 321, "a" * 100_000):
            r = _login(client, email=name)
            assert r.status_code == 401
            assert r.json() == unknown.json() == {"detail": "Invalid credentials"}
        assert stmts == []
    finally:
        event.remove(get_engine(), "before_cursor_execute", spy)


def _raw_token(claims, secret="test-secret"):
    return jwt.encode(claims, secret, algorithm="HS256")


def test_token_claim_validation(client, session):
    from api.security import create_access_token

    u = _seed(session)
    _me_route(client)
    good = {"sub": str(u.id), "role": "candidate", "exp": 9999999999}
    assert (
        client.get("/_me", headers=_hdr(create_access_token(u.id, "candidate"))).status_code == 200
    )
    assert client.get("/_me", headers=_hdr(_raw_token(good))).status_code == 200
    bad = [
        {k: v for k, v in good.items() if k != "exp"},
        {**good, "exp": "9999999999"},
        {**good, "exp": 1},
        {**good, "sub": "0"},
        {**good, "sub": "-3"},
        {**good, "sub": "abc"},
        {**good, "sub": u.id},
        {k: v for k, v in good.items() if k != "role"},
        {**good, "role": 5},
    ]
    for claims in bad:
        assert client.get("/_me", headers=_hdr(_raw_token(claims))).status_code == 401, claims
