from celery import Celery
from celery.signals import celeryd_init

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
