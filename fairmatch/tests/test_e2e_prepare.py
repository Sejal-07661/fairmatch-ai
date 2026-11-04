import os
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_prepare_creates_db_and_admin_can_log_in(tmp_path, monkeypatch):
    db = tmp_path / "e2e.db"
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "e2e_prepare.py"), str(db)],
        cwd=ROOT, capture_output=True, text=True, timeout=120, check=False,
        env={**os.environ, "JWT_SECRET": "e2e-secret"},
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == ""
    assert db.exists()

    monkeypatch.setenv("JWT_SECRET", "e2e-secret")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db.as_posix()}")
    monkeypatch.setenv("REDIS_URL", "fakeredis://")
    monkeypatch.setenv("CELERY_EAGER", "true")
    from api.config import get_settings
    from api.db import reset_engine_cache
    from api.main import create_app

    get_settings.cache_clear()
    reset_engine_cache()
    try:
        client = TestClient(create_app())
        r = client.post(
            "/auth/login", data={"username": "admin@example.com", "password": "E2e-Passw0rd!"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["access_token"]
    finally:
        reset_engine_cache()
        get_settings.cache_clear()


def test_prepare_refuses_a_database_that_already_has_users(tmp_path):
    db = tmp_path / "e2e.db"
    cmd = [sys.executable, str(ROOT / "scripts" / "e2e_prepare.py"), str(db)]
    env = {**os.environ, "JWT_SECRET": "e2e-secret"}
    first = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=120, check=False, env=env)
    assert first.returncode == 0, first.stderr
    second = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=120, check=False, env=env)
    assert second.returncode != 0
    assert "already contains users" in second.stderr
