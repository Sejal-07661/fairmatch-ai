"""Static checks on the backend container files (no Docker daemon needed)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def _req_names(rel: str) -> set[str]:
    names = set()
    for line in _read(rel).splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "-")):
            names.add(line.split("[")[0].split("=")[0].split("<")[0].split(">")[0].strip().lower())
    return names


def test_dockerfile_non_root():
    users = [ln.split()[1] for ln in _read("Dockerfile").splitlines()
             if ln.strip().upper().startswith("USER ")]
    assert users and users[-1] not in ("root", "0")


def test_dockerfile_runs_prefetch():
    assert "scripts/prefetch_model.py" in _read("Dockerfile")


def test_dockerignore_excludes_secrets():
    lines = {ln.strip() for ln in _read(".dockerignore").splitlines()}
    for pattern in (".env", "*.db", ".venv", "__pycache__", "tests"):
        assert pattern in lines or f"**/{pattern}" in lines, pattern


def test_runtime_requirements_exclude_dev_tools():
    runtime = _req_names("requirements.txt")
    for tool in ("pytest", "ruff", "fakeredis", "httpx"):
        assert tool not in runtime
    dev = _read("requirements-dev.txt")
    assert "-r requirements.txt" in dev
    dev_names = _req_names("requirements-dev.txt")
    assert {"pytest", "ruff", "fakeredis", "httpx"} <= dev_names


def test_entrypoint_is_exec_form():
    text = _read("docker/entrypoint.sh")
    assert 'exec "$@"' in text
    assert "set -eu" in text
    assert "JWT_SECRET" in text
