import subprocess
import sys

from celery.app.utils import find_app

from api.config import get_settings
from api.worker import celery_app, configure_celery, get_celery_app

ran = []


@celery_app.task
def _probe(x):
    ran.append(x)
    return x


def test_celery_eager_flag_follows_settings(monkeypatch):
    app = configure_celery()
    assert app is celery_app
    assert app.conf.task_always_eager is True
    assert app.conf.task_eager_propagates is True
    assert app.conf.accept_content == ["json"]

    monkeypatch.setenv("CELERY_EAGER", "false")
    monkeypatch.setenv("REDIS_URL", "redis://example:6379/1")
    get_settings.cache_clear()
    assert get_celery_app() is celery_app
    assert celery_app.conf.task_always_eager is False
    assert celery_app.conf.broker_url == "redis://example:6379/1"
    assert celery_app.conf.result_backend == "redis://example:6379/1"


def test_task_runs_eagerly_and_honours_settings_change(monkeypatch):
    configure_celery()
    assert _probe.delay(1).get() == 1
    monkeypatch.setenv("CELERY_EAGER", "false")
    get_settings.cache_clear()
    configure_celery()
    assert celery_app.conf.task_always_eager is False
    monkeypatch.setenv("CELERY_EAGER", "true")
    get_settings.cache_clear()
    configure_celery()
    assert _probe.delay(2).get() == 2
    assert ran[-2:] == [1, 2]


def test_find_app_resolves():
    assert find_app("api.worker.celery_app") is celery_app


def test_import_without_jwt_secret():
    code = "import api.worker as w; assert w.celery_app.main == 'fairmatch'"
    env = {k: v for k, v in __import__("os").environ.items() if k != "JWT_SECRET"}
    r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=False)
    assert r.returncode == 0, r.stderr


def test_worker_init_signal_applies_settings(monkeypatch):
    from celery.signals import celeryd_init

    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    get_settings.cache_clear()
    celery_app.conf.broker_url = "memory://"
    celeryd_init.send(sender="w@h", instance=None, conf=celery_app.conf, options={})
    assert celery_app.conf.broker_url == "redis://localhost:6379/0"
    monkeypatch.setenv("REDIS_URL", "fakeredis://")
    get_settings.cache_clear()
    configure_celery()
