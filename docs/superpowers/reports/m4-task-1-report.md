# M4 Task 1: Backend container image

Done (TDD: 5 tests failed first, then passed):
- fairmatch/Dockerfile (two-stage, python:3.13-slim, CPU torch extra index, model prefetched as root into HF_HOME=/opt/hf, user app uid 10001, healthcheck on /health, entrypoint + default uvicorn CMD)
- fairmatch/.dockerignore, fairmatch/docker/entrypoint.sh (set -eu, refuses empty JWT_SECRET, exec "$@")
- fairmatch/scripts/prefetch_model.py (uncaught error => non-zero exit)
- fairmatch/requirements.txt (pytest, ruff, fakeredis, httpx removed), fairmatch/requirements-dev.txt
- fairmatch/tests/test_docker_files.py (5 tests, pass)

Verification: ruff check . clean; backend suite "not slow and not llm and not db": 300 passed, 4 deselected (includes the 5 new tests). NUL scan of all changed files: none.

Not run: docker build / docker run (daemon off). Unverified: pip wheel with the pytorch CPU extra index, the BuildKit bind mount from builder, prefetch actually downloading at build, healthcheck.

Concerns:
- entrypoint.sh executable bit is not relied on (ENTRYPOINT is set after chmod in Dockerfile; CRLF stripped with sed).
- migrate/worker/api all go through the entrypoint, so all need JWT_SECRET (compose anchor must pass it).
- httpx removed from runtime list; openai pulls it transitively, but the app itself does not import it directly (tests only).
