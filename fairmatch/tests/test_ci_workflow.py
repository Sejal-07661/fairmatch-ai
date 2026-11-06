"""Static checks for the GitHub Actions workflow (CI itself only runs once pushed)."""

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
PLAYWRIGHT = ROOT / "frontend" / "playwright.config.ts"


@pytest.fixture(scope="module")
def wf() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _triggers(wf: dict) -> dict:
    # PyYAML (YAML 1.1) parses the bare key `on` as boolean True.
    return wf.get("on", wf.get(True))


def _run_text(job: dict) -> str:
    return "\n".join(s["run"] for s in job["steps"] if "run" in s)


def test_workflow_triggers_on_push_and_pr(wf):
    trig = _triggers(wf)
    for event in ("push", "pull_request"):
        assert set(trig[event]["branches"]) == {"main", "master"}
    assert wf["concurrency"]["cancel-in-progress"] is True


def test_jobs_present(wf):
    assert {"backend", "frontend", "e2e", "docker"} <= set(wf["jobs"])


def test_permissions_are_read_only(wf):
    assert wf["permissions"] == {"contents": "read"}


def test_actions_are_version_pinned(wf):
    uses = [s["uses"] for j in wf["jobs"].values() for s in j["steps"] if "uses" in s]
    assert uses
    for u in uses:
        assert re.search(r"@(v\d+|[0-9a-f]{40})$", u), u


def test_backend_runs_ruff_pytest_and_openapi_check(wf):
    text = _run_text(wf["jobs"]["backend"])
    assert "pip install -r requirements-dev.txt" in text
    assert "ruff check ." in text
    assert 'pytest -m "not slow and not llm and not db" -q' in text
    assert "python scripts/export_openapi.py --check" in text
    assert "pytest -m db -v" in text


def test_db_tests_use_pgvector_service(wf):
    job = wf["jobs"]["backend"]
    images = [s["image"] for s in job["services"].values()]
    assert "pgvector/pgvector:pg16" in images
    steps = [s for s in job["steps"] if "pytest -m db" in s.get("run", "")]
    assert steps
    assert steps[0]["env"]["TEST_DATABASE_URL"].startswith("postgresql+psycopg://")


def test_frontend_and_e2e_and_docker_commands(wf):
    fe = _run_text(wf["jobs"]["frontend"])
    for cmd in ("npm ci", "npm run lint", "npm run typecheck", "npm test", "npm run build", "npm run test:deploy"):
        assert cmd in fe
    e2e = _run_text(wf["jobs"]["e2e"])
    assert "playwright install --with-deps chromium" in e2e
    assert "npm run e2e" in e2e
    assert any(s.get("if") == "failure()" and "upload-artifact" in s.get("uses", "") for s in wf["jobs"]["e2e"]["steps"])
    dk = _run_text(wf["jobs"]["docker"])
    assert "docker compose build" in dk
    assert "docker compose config -q" in dk


def test_no_secrets_referenced_except_none():
    assert "secrets." not in WORKFLOW.read_text(encoding="utf-8")


def test_playwright_config_has_no_hardcoded_browser_path():
    text = PLAYWRIGHT.read_text(encoding="utf-8")
    assert "chromium-" not in text
    assert "E2E_CHROMIUM_PATH" in text


def test_frontend_installs_browser_before_test_deploy(wf):
    runs = [s.get("run", "") for s in wf["jobs"]["frontend"]["steps"]]
    install = next(i for i, r in enumerate(runs) if "playwright install" in r and "chromium" in r)
    deploy = next(i for i, r in enumerate(runs) if "npm run test:deploy" in r)
    assert install < deploy


def test_e2e_prefetches_model_into_the_cache_the_backend_reads(wf):
    job = wf["jobs"]["e2e"]
    steps = job["steps"]
    hf = job["env"]["HF_HOME"]
    cache = next(s for s in steps if str(s.get("uses", "")).startswith("actions/cache@"))
    assert cache["with"]["path"] == hf
    runs = [s.get("run", "") for s in steps]
    prefetch = next(i for i, r in enumerate(runs) if "prefetch_model.py" in r)
    e2e = next(i for i, r in enumerate(runs) if "npm run e2e" in r)
    assert prefetch < e2e
