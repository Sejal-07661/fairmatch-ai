import pytest
from sqlalchemy.exc import IntegrityError

from api.db import get_engine, get_session, reset_engine_cache
from api.models import Allocation, AllocationRun, Candidate, Opportunity, User


def _user(email="a@x.com"):
    return User(email=email, password_hash="h", role="candidate")


def _run(session):
    u = _user("admin@x.com")
    session.add(u)
    session.flush()
    run = AllocationRun(requested_by=u.id, algorithm="both", status="pending")
    session.add(run)
    session.flush()
    return u, run


def test_create_all_and_roundtrip(session):
    emb = [i / 384 for i in range(384)]
    u = _user()
    session.add(u)
    session.flush()
    c = Candidate(user_id=u.id, name="Ann", resume_text="r", skills=["python", "sql"],
                  experience_years=3.0, education_level=2, used_fallback=True,
                  embedding=emb)
    o = Opportunity(title="Dev", posting_text="p", required_skills=["python"], capacity=2,
                    min_experience_years=1.0, min_education_level=2)
    session.add_all([c, o])
    session.flush()
    _, run = _run(session)
    session.add(Allocation(run_id=run.id, algorithm="hungarian", candidate_id=c.id,
                           opportunity_id=o.id, score=0.8, breakdown={"a": 1},
                           reasons=["x"], narrative="n", used_fallback=False))
    session.commit()
    session.expire_all()
    c2 = session.get(Candidate, c.id)
    assert c2.embedding == emb
    assert c2.education_level == 2 and isinstance(c2.education_level, int)
    assert session.get(Opportunity, o.id).min_education_level == 2
    assert c2.skills == ["python", "sql"]
    assert c2.used_fallback is True
    a = session.query(Allocation).one()
    assert (a.score, a.breakdown, a.reasons, a.narrative) == (0.8, {"a": 1}, ["x"], "n")
    assert session.get(Opportunity, o.id).capacity == 2
    assert session.get(AllocationRun, run.id).status == "pending"


def test_allocation_unique_per_run_algorithm_candidate(session):
    u = _user()
    session.add(u)
    session.flush()
    c = Candidate(user_id=u.id, name="A", resume_text="", skills=[], experience_years=0,
                  education_level=0, used_fallback=False)
    o = Opportunity(title="t", posting_text="", required_skills=[], capacity=1,
                    min_experience_years=0, min_education_level=0)
    session.add_all([c, o])
    session.flush()
    _, run = _run(session)

    def alloc():
        return Allocation(run_id=run.id, algorithm="hungarian", candidate_id=c.id,
                          opportunity_id=o.id, score=1.0, breakdown={}, reasons=[],
                          narrative="", used_fallback=False)

    session.add(alloc())
    session.flush()
    session.add(alloc())
    with pytest.raises(IntegrityError):
        session.flush()


def test_email_unique(session):
    session.add(_user("dup@x.com"))
    session.flush()
    session.add(_user("dup@x.com"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_embedding_none_allowed(session):
    u = _user()
    session.add(u)
    session.flush()
    c = Candidate(user_id=u.id, name="A", resume_text="", skills=[], experience_years=0,
                  education_level=0, used_fallback=False)
    o = Opportunity(title="t", posting_text="", required_skills=[], capacity=1,
                    min_experience_years=0, min_education_level=0)
    session.add_all([c, o])
    session.commit()
    assert c.embedding is None and o.embedding is None


def test_session_rolls_back_on_error(session):
    from api.db import Base

    reset_engine_cache()
    Base.metadata.create_all(get_engine())
    gen = get_session()
    s = next(gen)
    s.add(_user("rb@x.com"))
    s.flush()
    with pytest.raises(RuntimeError):
        gen.throw(RuntimeError("boom"))
    gen2 = get_session()
    s2 = next(gen2)
    assert s2.query(User).count() == 0
    with pytest.raises(StopIteration):
        next(gen2)


def test_get_session_commits_on_success():
    from api.db import Base

    reset_engine_cache()
    Base.metadata.create_all(get_engine())
    gen = get_session()
    s = next(gen)
    s.add(_user("ok@x.com"))
    with pytest.raises(StopIteration):
        next(gen)
    gen2 = get_session()
    assert next(gen2).query(User).count() == 1
    gen2.close()


def _cand(session, email, **kw):
    u = _user(email)
    session.add(u)
    session.flush()
    c = Candidate(user_id=u.id, name="A", resume_text="", skills=[], experience_years=0,
                  education_level=0, used_fallback=False, **kw)
    session.add(c)
    return c


def test_embedding_none_is_sql_null(session):
    _cand(session, "n1@x.com", embedding=None)
    _cand(session, "n2@x.com")
    session.commit()
    assert session.query(Candidate).filter(Candidate.embedding.is_(None)).count() == 2


def test_embedding_rejects_wrong_dim_and_nan(session):
    from sqlalchemy.exc import StatementError

    _cand(session, "d@x.com", embedding=[0.1] * 64)
    with pytest.raises(StatementError):
        session.flush()
    session.rollback()
    _cand(session, "e@x.com", embedding=[float("nan")] * 384)
    with pytest.raises(StatementError):
        session.flush()


def test_cosine_distance_compiles_on_postgresql():
    from sqlalchemy.dialects import postgresql

    expr = Candidate.embedding.cosine_distance([0.0] * 384)
    assert "<=>" in str(expr.compile(dialect=postgresql.dialect()))


def test_session_fixture_visible_to_app_and_no_leak(session, client):
    from api.db import get_session
    from api.main import create_app

    session.add(_user("vis@x.com"))
    session.commit()
    app = client.app
    gen = get_session()
    s = next(gen)
    assert s.query(User).filter_by(email="vis@x.com").count() == 1
    gen.close()
    assert app is not None and create_app is not None


def test_no_state_leak_between_tests(session):
    assert session.query(User).count() == 0
