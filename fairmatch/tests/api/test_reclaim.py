from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, update

from api.config import get_settings
from api.models import AllocationRun, Candidate, Opportunity, User
from api.security import hash_password
from api.services import runs as runs_service

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 1, 12, 0, 0)  # naive, as the DB returns it


@pytest.fixture(autouse=True)
def _embedder(monkeypatch, fake_embedder_384):
    monkeypatch.setattr("api.services.embedding.get_embedder", lambda: fake_embedder_384)


def _run(session, status, created=None, started=None, error=None):
    u = session.query(User).first()
    if u is None:
        u = User(email="a@x.com", password_hash=hash_password("password123"), role="admin")
        session.add(u)
        session.commit()
    r = AllocationRun(requested_by=u.id, algorithm="hungarian", status=status,
                      created_at=created or NOW, started_at=started, error=error)
    session.add(r)
    session.commit()
    return r.id


def _seed(session):
    cu = User(email="c@x.com", password_hash=hash_password("password123"), role="candidate")
    session.add(cu)
    session.commit()
    session.add(Candidate(user_id=cu.id, name="C", resume_text="python sql", skills=["python"],
                          experience_years=1.0, education_level=2))
    session.add(Opportunity(title="J", posting_text="python", required_skills=["python"],
                            capacity=1, min_experience_years=0, min_education_level=0))
    session.commit()


def _get(session, rid):
    session.expire_all()
    return session.get(AllocationRun, rid)


def test_running_older_than_timeout_is_reclaimed(session):
    rid = _run(session, "running", started=NOW - timedelta(minutes=31), error="x")
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == [rid]
    r = _get(session, rid)
    assert (r.status, r.started_at, r.error) == ("pending", None, None)


def test_aware_now_and_naive_started_at_compare_safely(session):
    rid = _run(session, "running", started=NOW - timedelta(minutes=31))
    aware_now = NOW.replace(tzinfo=UTC)
    assert runs_service.reclaim_stuck_runs(session, now=aware_now) == [rid]


def test_aware_utc_started_at_compares_safely(session):
    # An aware UTC started_at is stored as its UTC wall clock; reading it back is naive.
    old = (NOW - timedelta(minutes=31)).replace(tzinfo=UTC)
    fresh = (NOW - timedelta(minutes=5)).replace(tzinfo=UTC)
    rid = _run(session, "running", started=old)
    keep = _run(session, "running", started=fresh)
    assert runs_service.reclaim_stuck_runs(session, now=NOW.replace(tzinfo=UTC)) == [rid]
    assert _get(session, keep).status == "running"


def test_aware_non_utc_now_is_converted(session):
    ist = timezone(timedelta(hours=5, minutes=30))
    rid = _run(session, "running", started=NOW - timedelta(minutes=31))
    fresh = _run(session, "running", started=NOW - timedelta(minutes=5))
    assert runs_service.reclaim_stuck_runs(session, now=NOW.replace(tzinfo=UTC).astimezone(ist)) == [rid]
    assert _get(session, fresh).status == "running"


def test_reclaim_does_not_overwrite_a_concurrent_fresh_claim(session, monkeypatch):
    """A run re-claimed between reclaim's read and its write must stay running."""
    rid = _run(session, "running", started=NOW - timedelta(minutes=31))
    real_execute = session.execute
    fired = []

    def racing_execute(stmt, *a, **k):
        if not fired and "UPDATE" in str(stmt).upper():
            fired.append(1)
            real_execute(
                update(AllocationRun).where(AllocationRun.id == rid).values(started_at=NOW)
            )
        return real_execute(stmt, *a, **k)

    monkeypatch.setattr(session, "execute", racing_execute)
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == []
    r = _get(session, rid)
    assert r.status == "running" and r.started_at == NOW


def test_periodic_reclaim_task_is_scheduled_every_five_minutes():
    from api.worker import celery_app

    entry = next(e for e in celery_app.conf.beat_schedule.values() if e["task"] == "api.reclaim_stuck")
    assert entry["schedule"] == 300.0
    assert "api.reclaim_stuck" in celery_app.tasks


def test_periodic_reclaim_task_enqueues_reclaimed(session, monkeypatch):
    from api.worker import reclaim_stuck

    rid = _run(session, "pending", created=datetime.now(UTC) - timedelta(minutes=10))
    sent = []
    monkeypatch.setattr("api.worker.run_allocation.delay", lambda i: sent.append(i))
    reclaim_stuck()
    assert sent == [rid]


def test_periodic_reclaim_task_swallows_errors(monkeypatch):
    from api.worker import reclaim_stuck

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr("api.services.runs.reclaim_stuck_runs", boom)
    reclaim_stuck()  # must not raise


def test_fresh_running_run_is_left_alone(session):
    rid = _run(session, "running", started=NOW - timedelta(minutes=5))
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == []
    assert _get(session, rid).status == "running"


def test_old_pending_run_is_returned_for_enqueue(session):
    rid = _run(session, "pending", created=NOW - timedelta(minutes=6))
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == [rid]
    assert _get(session, rid).status == "pending"


def test_recent_pending_run_is_left_alone(session):
    _run(session, "pending", created=NOW - timedelta(minutes=1))
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == []


def test_done_and_failed_runs_never_reclaimed(session):
    old = NOW - timedelta(days=2)
    _run(session, "done", created=old, started=old)
    _run(session, "failed", created=old, started=old)
    assert runs_service.reclaim_stuck_runs(session, now=NOW) == []


def test_execute_run_sets_started_at(session):
    _seed(session)
    rid = _run(session, "pending")
    runs_service.execute_run(session, rid)
    r = _get(session, rid)
    assert r.status == "done"
    assert r.started_at is not None


def test_execute_run_takes_over_expired_running_run(session):
    _seed(session)
    old = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=45)
    rid = _run(session, "running", started=old)
    runs_service.execute_run(session, rid)
    assert _get(session, rid).status == "done"


def test_execute_run_ignores_fresh_running_run(session):
    _seed(session)
    fresh = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=1)
    rid = _run(session, "running", started=fresh)
    runs_service.execute_run(session, rid)
    r = _get(session, rid)
    assert r.status == "running"
    assert r.started_at == fresh


def test_worker_ready_handler_swallows_errors(monkeypatch):
    from celery.signals import worker_ready

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr("api.services.runs.reclaim_stuck_runs", boom)
    worker_ready.send(sender=None)  # must not raise


def test_worker_ready_handler_enqueues_reclaimed(session, monkeypatch):
    from celery.signals import worker_ready

    rid = _run(session, "pending", created=datetime.now(UTC) - timedelta(minutes=10))
    sent = []
    monkeypatch.setattr("api.worker.run_allocation.delay", lambda i: sent.append(i))
    worker_ready.send(sender=None)
    assert sent == [rid]


def test_migration_0002_adds_started_at(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'm.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    engine = create_engine(url)

    def cols():
        return {c["name"] for c in inspect(engine).get_columns("allocation_runs")}

    command.upgrade(cfg, "0001")
    assert "started_at" not in cols()
    command.upgrade(cfg, "head")
    assert "started_at" in cols()
    command.downgrade(cfg, "0001")
    assert "started_at" not in cols()
    engine.dispose()
