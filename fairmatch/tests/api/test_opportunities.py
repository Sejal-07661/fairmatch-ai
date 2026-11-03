import pytest

from api.models import Opportunity, User
from api.security import hash_password


def _user(session, email, role):
    u = User(email=email, password_hash=hash_password("password123"), role=role)
    session.add(u)
    session.commit()
    return u


def _token(client, email):
    r = client.post("/auth/login", data={"username": email, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _embedder(monkeypatch, fake_embedder_384):
    monkeypatch.setattr("api.services.embedding.get_embedder", lambda: fake_embedder_384)


BODY = {
    "title": "Data Analyst",
    "posting_text": "Looking for python and sql skills.",
    "capacity": 2,
    "min_experience_years": 1,
    "min_education_level": 2,
}


def test_admin_creates_opportunity(session, client):
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json=BODY, headers=_token(client, "admin@x.com"))
    assert r.status_code == 201
    data = r.json()
    assert data["capacity"] == 2 and "python" in data["required_skills"]
    session.expire_all()
    assert len(session.get(Opportunity, data["id"]).embedding) == 384


def test_candidate_cannot_create_403(session, client):
    _user(session, "c@x.com", "candidate")
    r = client.post("/opportunities", json=BODY, headers=_token(client, "c@x.com"))
    assert r.status_code == 403


@pytest.mark.parametrize(
    "patch",
    [
        {"capacity": 0},
        {"min_experience_years": -1},
        {"min_education_level": 5},
        {"min_education_level": -1},
        {"title": "   "},
        {"title": "x" * 201},
        {"posting_text": " "},
        {"posting_text": "x" * 20001},
    ],
)
def test_invalid_422(session, client, patch):
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json={**BODY, **patch}, headers=_token(client, "admin@x.com"))
    assert r.status_code == 422


def test_capacity_zero_422(session, client):
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json={**BODY, "capacity": 0},
                    headers=_token(client, "admin@x.com"))
    assert r.status_code == 422


def test_education_level_out_of_range_422(session, client):
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json={**BODY, "min_education_level": 5},
                    headers=_token(client, "admin@x.com"))
    assert r.status_code == 422


def test_any_authenticated_user_can_list(session, client):
    _user(session, "admin@x.com", "admin")
    _user(session, "c@x.com", "candidate")
    h = _token(client, "admin@x.com")
    for _ in range(3):
        client.post("/opportunities", json=BODY, headers=h)
    hc = _token(client, "c@x.com")
    r = client.get("/opportunities", headers=hc)
    assert r.status_code == 200 and len(r.json()) == 3
    assert len(client.get("/opportunities?limit=2&offset=2", headers=hc).json()) == 1
    assert client.get("/opportunities?limit=0", headers=hc).status_code == 422
    assert client.get("/opportunities?limit=101", headers=hc).status_code == 422
    assert client.get("/opportunities?offset=-1", headers=hc).status_code == 422
    one = r.json()[0]["id"]
    assert client.get(f"/opportunities/{one}", headers=hc).status_code == 200
    assert client.get("/opportunities/9999", headers=hc).status_code == 404


def test_unauthenticated_401(client):
    assert client.get("/opportunities").status_code == 401
    assert client.post("/opportunities", json=BODY).status_code == 401


@pytest.mark.parametrize(
    "patch",
    [
        {"capacity": 2**63},
        {"capacity": 10**9},
        {"capacity": 10_001},
        {"min_experience_years": 81},
        {"title": "a\x00b"},
        {"posting_text": "py\x00thon"},
    ],
)
def test_bounds_and_nul_422(session, client, patch):
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json={**BODY, **patch}, headers=_token(client, "admin@x.com"))
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert str(2**63) not in r.text and "1000000000" not in r.text


def test_nan_inf_422(session, client):
    _user(session, "admin@x.com", "admin")
    h = _token(client, "admin@x.com")
    for raw in ("NaN", "Infinity", "-Infinity"):
        body = (
            '{"title":"t","posting_text":"python","capacity":1,'
            f'"min_experience_years":{raw},"min_education_level":1}}'
        )
        r = client.post("/opportunities", content=body,
                        headers={**h, "Content-Type": "application/json"})
        assert r.status_code == 422 and isinstance(r.json()["detail"], str)
        assert raw not in r.text


def test_huge_id_and_offset_422(session, client):
    _user(session, "admin@x.com", "admin")
    h = _token(client, "admin@x.com")
    assert client.get(f"/opportunities/{2**70}", headers=h).status_code == 422
    r = client.get("/opportunities?offset=" + "9" * 50, headers=h)
    assert r.status_code == 422 and "9" * 20 not in r.text


def test_enqueue_failure_still_201(session, client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("redis down")

    monkeypatch.setattr("api.routers.opportunities.embed_profile.delay", boom)
    _user(session, "admin@x.com", "admin")
    r = client.post("/opportunities", json=BODY, headers=_token(client, "admin@x.com"))
    assert r.status_code == 201
