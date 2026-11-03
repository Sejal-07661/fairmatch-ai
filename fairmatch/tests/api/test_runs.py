import pytest
from sqlalchemy import select, update

from api.db import SessionLocal
from api.models import (
    Allocation,
    AllocationRun,
    Candidate,
    CandidateDemographics,
    Opportunity,
    User,
)
from api.security import hash_password
from api.services import runs as runs_service


@pytest.fixture(autouse=True)
def _embedder(monkeypatch, fake_embedder_384):
    monkeypatch.setattr("api.services.embedding.get_embedder", lambda: fake_embedder_384)


def _user(session, email, role="admin"):
    u = User(email=email, password_hash=hash_password("password123"), role=role)
    session.add(u)
    session.commit()
    return u


def _hdr(client, email):
    r = client.post("/auth/login", data={"username": email, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(session, n_cand=3, caps=(1, 2), labels=None):
    cands = []
    for i in range(n_cand):
        u = _user(session, f"cand{i}@x.com", "candidate")
        c = Candidate(
            user_id=u.id, name=f"Cand {i}", resume_text="SECRET resume python sql engineer",
            skills=["python"], experience_years=2.0, education_level=2,
        )
        session.add(c)
        cands.append(c)
    opps = []
    for j, cap in enumerate(caps):
        o = Opportunity(
            title=f"Job {j}", posting_text="python sql analyst", required_skills=["python"],
            capacity=cap, min_experience_years=0, min_education_level=0,
        )
        session.add(o)
        opps.append(o)
    session.commit()
    if labels:
        for c, lab in zip(cands, labels, strict=True):
            session.add(CandidateDemographics(candidate_id=c.id, group_label=lab))
        session.commit()
    return cands, opps


def _admin(session, client):
    _user(session, "admin@x.com")
    return _hdr(client, "admin@x.com")


def _runs(session):
    session.expire_all()
    return list(session.scalars(select(AllocationRun)))


def _allocs(session, run_id=None):
    session.expire_all()
    q = select(Allocation)
    if run_id:
        q = q.where(Allocation.run_id == run_id)
    return list(session.scalars(q))


def test_run_both_algorithms_persists_allocations_and_metrics(session, client):
    h = _admin(session, client)
    _seed(session)
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 202 and r.json()["status"] == "done"
    body = client.get(f"/runs/{r.json()['id']}", headers=h).json()
    assert body["status"] == "done" and body["error"] is None and body["finished_at"]
    assert set(body["metrics"]) >= {"hungarian", "gale_shapley"}
    caps = {o.id: o.capacity for o in session.scalars(select(Opportunity))}
    for algo in ("hungarian", "gale_shapley"):
        m = body["metrics"][algo]
        assert {"total_score", "blocking_pairs", "runtime_ms", "unallocated"} <= set(m)
        rows = [a for a in body["allocations"] if a["algorithm"] == algo]
        assert len(rows) == 3 and len(m["unallocated"]) == 0
        by_opp = {}
        for a in rows:
            by_opp[a["opportunity_id"]] = by_opp.get(a["opportunity_id"], 0) + 1
        assert all(n <= caps[o] for o, n in by_opp.items())


def test_run_single_algorithm_persists_only_that_one(session, client):
    h = _admin(session, client)
    _seed(session, labels=["a", "b", "a"])
    r = client.post("/runs", json={"algorithm": "hungarian"}, headers=h)
    body = client.get(f"/runs/{r.json()['id']}", headers=h).json()
    assert {a["algorithm"] for a in body["allocations"]} == {"hungarian"}
    assert set(body["metrics"]) - {"fairness_skipped"} == {"hungarian"}
    assert set(body["fairness"]) == {"hungarian"}


def test_invalid_algorithm_422(session, client):
    h = _admin(session, client)
    _seed(session)
    assert client.post("/runs", json={"algorithm": "x"}, headers=h).status_code == 422
    assert _runs(session) == []


def test_zero_candidates_422_no_run_row(session, client):
    h = _admin(session, client)
    session.add(Opportunity(title="J", posting_text="p", required_skills=[], capacity=1,
                            min_experience_years=0, min_education_level=0))
    session.commit()
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 422 and "candidate" in r.json()["detail"]
    assert _runs(session) == []


def test_zero_opportunities_422(session, client):
    h = _admin(session, client)
    _seed(session, caps=())
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 422 and "opportunit" in r.json()["detail"]
    assert _runs(session) == []


def test_total_seats_zero_422(session, client):
    h = _admin(session, client)
    _, opps = _seed(session)
    for o in opps:
        o.capacity = 0
    session.commit()
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 422 and "seat" in r.json()["detail"]
    assert _runs(session) == []


def test_size_guard_422_states_limits(session, client, monkeypatch):
    h = _admin(session, client)
    _seed(session)
    monkeypatch.setattr(runs_service, "MAX_CELLS", 8)  # 3 candidates * 3 seats = 9
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 422 and "8" in r.json()["detail"]
    assert _runs(session) == []


def test_pipeline_exception_marks_run_failed_with_message(session, client, monkeypatch):
    h = _admin(session, client)
    _seed(session)

    def boom(*a, **k):
        raise RuntimeError("kaboom " + "x" * 600)

    monkeypatch.setattr(runs_service, "run_pipeline", boom)
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 202 and r.json()["status"] == "failed"
    body = client.get(f"/runs/{r.json()['id']}", headers=h).json()
    assert body["status"] == "failed" and body["error"].startswith("kaboom")
    assert len(body["error"]) <= 500 and body["allocations"] == []
    assert client.get("/health").status_code == 200


def test_nan_score_marks_run_failed(session, client, monkeypatch):
    h = _admin(session, client)
    _seed(session)
    real = runs_service.run_pipeline

    def nan_pipeline(*a, **k):
        res = real(*a, **k)
        object.__setattr__(res.results["hungarian"], "total_score", float("nan"))
        return res

    monkeypatch.setattr(runs_service, "run_pipeline", nan_pipeline)
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.json()["status"] == "failed"
    assert _allocs(session) == []


def test_enqueue_failure_503_and_run_failed(session, client, monkeypatch):
    h = _admin(session, client)
    _seed(session)

    def nope(*a, **k):
        raise ConnectionError("broker down")

    monkeypatch.setattr("api.routers.runs.run_allocation.delay", nope)
    r = client.post("/runs", json={"algorithm": "both"}, headers=h)
    assert r.status_code == 503 and isinstance(r.json()["detail"], str)
    rows = _runs(session)
    assert len(rows) == 1 and rows[0].status == "failed" and rows[0].error


def test_rerun_of_done_run_is_noop_and_no_duplicates(session, client):
    h = _admin(session, client)
    _seed(session)
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    before = sorted((a.id, a.candidate_id) for a in _allocs(session, rid))
    s = SessionLocal()
    runs_service.execute_run(s, rid)
    runs_service.execute_run(s, rid)
    s.close()
    after = sorted((a.id, a.candidate_id) for a in _allocs(session, rid))
    assert before == after and len(after) == 6


def test_running_run_is_not_reclaimed(session, client):
    h = _admin(session, client)
    _seed(session)
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    session.execute(update(AllocationRun).where(AllocationRun.id == rid).values(status="running"))
    session.commit()
    s = SessionLocal()
    runs_service.execute_run(s, rid)
    s.close()
    assert _runs(session)[0].status == "running"


def test_rerun_of_failed_run_replaces_partial_rows(session, client):
    h = _admin(session, client)
    _seed(session)
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    session.execute(update(AllocationRun).where(AllocationRun.id == rid).values(status="failed"))
    session.execute(
        update(Allocation).where(Allocation.algorithm == "gale_shapley").values(score=-99.0)
    )
    session.commit()
    s = SessionLocal()
    runs_service.execute_run(s, rid)
    s.close()
    rows = _allocs(session, rid)
    assert len(rows) == 6 and all(a.score != -99.0 for a in rows)
    assert _runs(session)[0].status == "done"


def test_fairness_computed_when_all_have_demographics(session, client):
    h = _admin(session, client)
    _seed(session, labels=["alpha", "beta", "alpha"])
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    body = client.get(f"/runs/{rid}", headers=h).json()
    assert "fairness_skipped" not in body["metrics"]
    assert set(body["fairness"]) == {"hungarian", "gale_shapley"}
    assert "disparate_impact_ratio" in body["fairness"]["hungarian"]


def test_fairness_skipped_when_some_missing_and_recorded(session, client):
    h = _admin(session, client)
    cands, _ = _seed(session, labels=["alpha", "beta", "alpha"])
    session.delete(session.get(CandidateDemographics, cands[1].id))
    session.commit()
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    body = client.get(f"/runs/{rid}", headers=h).json()
    assert body["status"] == "done" and not body["fairness"]
    assert body["metrics"]["fairness_skipped"] == "demographics missing for 1 of 3 candidates"


def test_candidate_role_cannot_start_or_read_runs_403(session, client):
    h = _admin(session, client)
    _seed(session)
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    ch = _hdr(client, "cand0@x.com")
    assert client.post("/runs", json={"algorithm": "both"}, headers=ch).status_code == 403
    for path in ("/runs", f"/runs/{rid}", f"/runs/{rid}/explanations"):
        assert client.get(path, headers=ch).status_code == 403
    assert client.get("/runs").status_code == 401


def test_unknown_run_404(session, client):
    h = _admin(session, client)
    assert client.get("/runs/999", headers=h).status_code == 404
    assert client.get("/runs/999/explanations", headers=h).status_code == 404
    assert client.get("/runs/0", headers=h).status_code == 422


def test_list_runs_pagination_bounds(session, client):
    h = _admin(session, client)
    _seed(session)
    for _ in range(3):
        client.post("/runs", json={"algorithm": "hungarian"}, headers=h)
    assert len(client.get("/runs", headers=h).json()) == 3
    assert len(client.get("/runs?limit=2", headers=h).json()) == 2
    assert client.get("/runs?limit=0", headers=h).status_code == 422
    assert client.get("/runs?limit=101", headers=h).status_code == 422
    assert client.get("/runs?offset=2147483648", headers=h).status_code == 422


def test_pending_run_returns_empty_allocations(session, client):
    h = _admin(session, client)
    admin = session.scalars(select(User)).first()
    run = AllocationRun(requested_by=admin.id, algorithm="both", status="pending")
    session.add(run)
    session.commit()
    body = client.get(f"/runs/{run.id}", headers=h).json()
    assert body["status"] == "pending" and body["allocations"] == []
    assert client.get(f"/runs/{run.id}/explanations", headers=h).json() == []


def test_explanations_endpoint_returns_reasons_without_resume_text(session, client):
    h = _admin(session, client)
    _seed(session, labels=["grpSECRET", "b", "grpSECRET"])
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    r = client.get(f"/runs/{rid}/explanations", headers=h)
    assert r.status_code == 200 and len(r.json()) == 6
    item = r.json()[0]
    assert set(item) == {"algorithm", "candidate_id", "opportunity_id", "score", "reasons",
                         "narrative", "used_fallback"}
    assert item["reasons"]
    assert "SECRET" not in r.text and "resume" not in r.text.lower()


def test_allocation_ids_map_back_to_database_ids(session, client):
    h = _admin(session, client)
    cands, opps = _seed(session, n_cand=4, caps=(1, 1, 1))
    session.delete(session.get(Candidate, cands[1].id))
    session.delete(session.get(Opportunity, opps[0].id))
    session.commit()
    cids = {c.id for c in session.scalars(select(Candidate))}
    oids = {o.id for o in session.scalars(select(Opportunity))}
    assert cids != {1, 2, 3} and oids != {1, 2}
    rid = client.post("/runs", json={"algorithm": "both"}, headers=h).json()["id"]
    body = client.get(f"/runs/{rid}", headers=h).json()
    assert body["status"] == "done"
    for a in body["allocations"]:
        assert a["candidate_id"] in cids and a["opportunity_id"] in oids
    for algo in ("hungarian", "gale_shapley"):
        placed = {a["candidate_id"] for a in body["allocations"] if a["algorithm"] == algo}
        unalloc = set(body["metrics"][algo]["unallocated"])
        assert unalloc <= cids and placed | unalloc == cids and not placed & unalloc
        assert len(unalloc) == 1  # 3 candidates, 2 seats
