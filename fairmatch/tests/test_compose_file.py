import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
SERVICES = COMPOSE["services"]
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")


def _env(name):
    env = SERVICES[name].get("environment", {})
    if isinstance(env, list):
        env = dict(item.split("=", 1) for item in env)
    return env


def test_expected_services():
    assert set(SERVICES) == {"postgres", "redis", "migrate", "api", "worker", "web"}


def test_only_web_publishes_a_port():
    assert [n for n, s in SERVICES.items() if s.get("ports")] == ["web"]
    assert SERVICES["web"]["ports"] == ["${WEB_PORT:-8080}:8080"]
    assert not any(s.get("ports") for n, s in SERVICES.items() if n != "web")


def test_jwt_secret_has_no_default():
    for name in ("migrate", "api", "worker"):
        assert str(_env(name)["JWT_SECRET"]).startswith("${JWT_SECRET:?"), name


def test_api_and_worker_wait_for_migrate_completed():
    for name in ("api", "worker"):
        dep = SERVICES[name]["depends_on"]["migrate"]
        assert dep["condition"] == "service_completed_successfully"
    assert SERVICES["migrate"]["restart"] == "no"
    assert SERVICES["migrate"]["command"] == ["alembic", "upgrade", "head"]


def test_postgres_and_redis_have_healthchecks_and_dependents_wait_healthy():
    for name in ("postgres", "redis"):
        assert SERVICES[name]["healthcheck"]["test"]
    for name in ("migrate", "api", "worker"):
        deps = SERVICES[name]["depends_on"]
        for dep in ("postgres", "redis"):
            if name == "migrate" and dep == "redis":
                continue
            assert deps[dep]["condition"] == "service_healthy", (name, dep)
    assert SERVICES["web"]["depends_on"]["api"]["condition"] == "service_healthy"


def test_postgres_uses_named_volume():
    vols = SERVICES["postgres"]["volumes"]
    assert any(v.startswith("pgdata:") for v in vols)
    assert "pgdata" in COMPOSE["volumes"]


def test_database_url_targets_postgres_service():
    for name in ("migrate", "api", "worker"):
        url = _env(name)["DATABASE_URL"]
        assert url.startswith("postgresql+psycopg://")
        assert "@postgres:5432/" in url


def test_redis_url_targets_redis_service():
    for name in ("api", "worker"):
        assert _env(name)["REDIS_URL"].startswith("redis://redis:6379/")


def test_no_secret_literals():
    assert "${POSTGRES_PASSWORD:?" in _env("api")["DATABASE_URL"]
    assert str(_env("postgres")["POSTGRES_PASSWORD"]).startswith("${POSTGRES_PASSWORD:?")
    text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert not re.search(r"PASSWORD:\s*fairmatch\b", text)
    assert ":fairmatch@" not in text


def test_worker_command_and_backend_images():
    assert SERVICES["worker"]["command"][:3] == ["celery", "-A", "api.worker:celery_app"]
    for name in ("migrate", "api", "worker"):
        assert SERVICES[name]["build"] == "./fairmatch"
    assert SERVICES["web"]["build"] == "./frontend"
    for name in ("api", "worker"):
        assert SERVICES[name]["restart"] == "unless-stopped"


def test_env_example_has_every_required_key_and_no_real_secret():
    keys = dict(
        line.split("=", 1)
        for line in ENV_EXAMPLE.splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    assert set(keys) >= {
        "JWT_SECRET", "POSTGRES_PASSWORD", "OPENAI_API_KEY", "WEB_PORT", "ACCESS_TOKEN_MINUTES",
    }
    assert keys["WEB_PORT"] == "8080"
    assert keys["ACCESS_TOKEN_MINUTES"] == "60"
    assert keys["OPENAI_API_KEY"] == ""
    for k in ("JWT_SECRET", "POSTGRES_PASSWORD"):
        assert keys[k].startswith("change-me"), k
