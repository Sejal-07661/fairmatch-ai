from celery import Celery
from celery.signals import celeryd_init, worker_ready

from api.config import get_settings

# Built at import with no settings access, so tasks can use @celery_app.task
# and importing this module never requires JWT_SECRET.
celery_app = Celery("fairmatch")
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_eager_propagates=True,
)


def configure_celery() -> Celery:
    """Apply current settings to the shared app (idempotent)."""
    s = get_settings()
    broker, backend = s.redis_url, s.redis_url
    if broker.startswith("fakeredis://"):  # test mode: no Redis transport
        broker, backend = "memory://", "cache+memory://"
    celery_app.conf.update(
        broker_url=broker,
        result_backend=backend,
        task_always_eager=s.celery_eager,
    )
    return celery_app


def get_celery_app() -> Celery:
    return configure_celery()


@celeryd_init.connect
def _configure_on_worker_start(*args, **kwargs):
    configure_celery()


@celery_app.task(name="api.embed_profile")
def embed_profile(kind: str, row_id: int) -> None:
    """Embed a stored candidate/opportunity. Idempotent; no-op if row is gone."""
    import logging

    from api.db import SessionLocal
    from api.models import Candidate, Opportunity
    from api.services import embedding

    log = logging.getLogger(__name__)
    model = {"candidate": Candidate, "opportunity": Opportunity}.get(kind)
    if model is None:
        log.warning("embed_profile: unknown kind %r", kind)
        return
    session = SessionLocal()
    try:
        row = session.get(model, row_id)
        if row is None:
            return
        text = row.resume_text if kind == "candidate" else row.posting_text
        try:
            vec = embedding.get_embedder().encode([text])[0]
            row.embedding = [float(x) for x in vec]
        except Exception:
            log.exception("embedding failed for %s %s", kind, row_id)
            session.rollback()
            return
        session.commit()
    finally:
        session.close()


@celery_app.task(name="api.run_allocation")
def run_allocation(run_id: int) -> None:
    """Execute an allocation run. Idempotent per run id; never raises."""
    import logging

    from api.db import SessionLocal
    from api.services.runs import execute_run

    session = SessionLocal()
    try:
        execute_run(session, run_id)
    except Exception:
        logging.getLogger(__name__).exception("run_allocation %s crashed", run_id)
    finally:
        session.close()


@worker_ready.connect
def _reclaim_on_worker_ready(*args, **kwargs):
    """Re-enqueue stuck or never-enqueued runs when a worker starts. Never raises."""
    import logging

    log = logging.getLogger(__name__)
    try:
        from api.db import SessionLocal
        from api.services.runs import reclaim_stuck_runs

        session = SessionLocal()
        try:
            ids = reclaim_stuck_runs(session)
        finally:
            session.close()
        for run_id in ids:
            run_allocation.delay(run_id)
        if ids:
            log.info("reclaimed runs: %s", ids)
    except Exception:
        log.exception("reclaiming stuck runs failed")
