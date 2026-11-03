import pytest
from sqlalchemy import select

from api.cli import create_admin
from api.models import Candidate, Opportunity, User
from api.security import hash_password


@pytest.fixture(autouse=True)
def _embedder(monkeypatch, fake_embedder_384):
    monkeypatch.setattr("api.services.embedding.get_embedder", lambda: fake_embedder_384)


def _hdr(client, email, password="password123"):
    r = client.post("/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _admin(session, client):
    create_admin(session, "admin@x.com", "password123")
    return _hdr(client, "admin@x.com")


def _opp(session, text="python sql analyst"):
    o = Opportunity(
        title="Job", posting_text=text, required_skills=["python"], capacity=1,
        min_experience_years=0, min_education_level=0,
    )
    session.add(o)
    session.commit()
    return o


def _cand(session, i, text, emb):
    u = User(email=f"c{i}@x.com", password_hash=hash_password("password123"), role="candidate")
    session.add(u)
    session.commit()
    c = Candidate(user_id=u.id, name=f"Name{i}", resume_text=text, skills=["python"],
                  experience_years=1.0, education_level=2, embedding=emb)
    session.add(c)
    session.commit()
    return c


def _vec(embedder, text):
    return [float(x) for x in embedder.encode([text])[0]]


def test_similar_candidates_sorted_by_similarity(session, client, fake_embedder_384):
    o = _opp(session)
    e = fake_embedder_384
    c1 = _cand(session, 1, "x", _vec(e, "gardening flowers"))
    c2 = _cand(session, 2, "x", _vec(e, "python sql analyst"))
    c3 = _cand(session, 3, "x", _vec(e, "python cooking"))
    _cand(session, 4, "x", None)
    o.embedding = _vec(e, "python sql analyst")
    session.commit()
    h = _admin(session, client)
    r = client.get(f"/opportunities/{o.id}/similar-candidates", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert [b["candidate_id"] for b in body] == [c2.id, c3.id, c1.id]
    assert set(body[0]) == {"candidate_id", "similarity"}
    assert body[0]["similarity"] == pytest.approx(1.0, abs=1e-6)
    sims = [b["similarity"] for b in body]
    assert sims == sorted(sims, reverse=True)
    r = client.get(f"/opportunities/{o.id}/similar-candidates?limit=1", headers=h)
    assert [b["candidate_id"] for b in r.json()] == [c2.id]


def test_similar_ties_broken_by_lower_id(session, client, fake_embedder_384):
    o = _opp(session)
    v = _vec(fake_embedder_384, "python")
    a = _cand(session, 1, "x", v)
    b = _cand(session, 2, "x", v)
    o.embedding = v
    session.commit()
    h = _admin(session, client)
    r = client.get(f"/opportunities/{o.id}/similar-candidates", headers=h)
    assert [x["candidate_id"] for x in r.json()] == [a.id, b.id]


def test_similar_no_embeddings_returns_empty(session, client, fake_embedder_384):
    o = _opp(session)  # no embedding
    _cand(session, 1, "x", _vec(fake_embedder_384, "python"))
    h = _admin(session, client)
    r = client.get(f"/opportunities/{o.id}/similar-candidates", headers=h)
    assert r.status_code == 200 and r.json() == []
    o.embedding = _vec(fake_embedder_384, "python")
    session.commit()
    p = _cand(session, 2, "x", None)
    r = client.get(f"/opportunities/{o.id}/similar-candidates", headers=h)
    assert p.id not in [x["candidate_id"] for x in r.json()]


def test_similar_unknown_opportunity_404(session, client):
    h = _admin(session, client)
    r = client.get("/opportunities/999/similar-candidates", headers=h)
    assert r.status_code == 404 and isinstance(r.json()["detail"], str)


def test_similar_limit_validation_422(session, client, fake_embedder_384):
    o = _opp(session)
    h = _admin(session, client)
    for bad in ("0", "51", "abc"):
        r = client.get(f"/opportunities/{o.id}/similar-candidates?limit={bad}", headers=h)
        assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert client.get("/opportunities/0/similar-candidates", headers=h).status_code == 422


def test_similar_requires_admin_403(session, client):
    o = _opp(session)
    assert client.get(f"/opportunities/{o.id}/similar-candidates").status_code == 401
    client.post("/auth/register", json={"email": "u@x.com", "password": "password123"})
    r = client.get(f"/opportunities/{o.id}/similar-candidates", headers=_hdr(client, "u@x.com"))
    assert r.status_code == 403 and isinstance(r.json()["detail"], str)


def test_similar_zero_vector_is_zero_similarity(session, client, fake_embedder_384):
    o = _opp(session)
    e = fake_embedder_384
    z = _cand(session, 1, "x", [0.0] * 384)
    g = _cand(session, 2, "x", _vec(e, "python"))
    o.embedding = _vec(e, "python")
    session.commit()
    h = _admin(session, client)
    body = client.get(f"/opportunities/{o.id}/similar-candidates", headers=h).json()
    assert body == [
        {"candidate_id": g.id, "similarity": pytest.approx(1.0, abs=1e-6)},
        {"candidate_id": z.id, "similarity": 0.0},
    ]


def test_end_to_end_flow(session, client):
    create_admin(session, "admin@x.com", "password123")
    ha = _hdr(client, "admin@x.com")
    cids, hcs = [], []
    texts = ["Python developer with 3 years of python and sql. Bachelor degree.",
             "Data analyst with 2 years of excel and sql. Master degree."]
    for i, t in enumerate(texts):
        email = f"cand{i}@x.com"
        assert client.post("/auth/register",
                           json={"email": email, "password": "password123"}).status_code == 201
        hc = _hdr(client, email)
        r = client.post("/candidates", data={"name": f"Cand{i}", "resume_text": t}, headers=hc)
        assert r.status_code == 201
        cids.append(r.json()["id"])
        hcs.append(hc)
    for j in range(2):
        r = client.post("/opportunities", headers=ha, json={
            "title": f"Job{j}", "posting_text": "python sql analyst needed", "capacity": 1,
            "min_experience_years": 0, "min_education_level": 0})
        assert r.status_code == 201
    labels = ["GROUP_ALPHA", "GROUP_BETA"]
    for cid, lab in zip(cids, labels, strict=True):
        r = client.put(f"/candidates/{cid}/demographics", json={"group_label": lab}, headers=ha)
        assert r.status_code == 200
    r = client.post("/runs", json={"algorithm": "both"}, headers=ha)
    assert r.status_code == 202
    rid = r.json()["id"]
    body = client.get(f"/runs/{rid}", headers=ha).json()
    assert body["status"] == "done"
    caps = {o.id: o.capacity for o in session.scalars(select(Opportunity))}
    for algo in ("hungarian", "gale_shapley"):
        rows = [a for a in body["allocations"] if a["algorithm"] == algo]
        assert rows
        for oid, cap in caps.items():
            assert sum(1 for a in rows if a["opportunity_id"] == oid) <= cap
    assert set(body["fairness"]) == {"hungarian", "gale_shapley"}
    ex = client.get(f"/runs/{rid}/explanations", headers=ha)
    assert ex.status_code == 200 and ex.json()
    dump = ex.text
    for secret in [*labels, *texts, "Python developer with 3 years"]:
        assert secret not in dump
    for hc in hcs:
        assert client.get(f"/runs/{rid}", headers=hc).status_code == 403
