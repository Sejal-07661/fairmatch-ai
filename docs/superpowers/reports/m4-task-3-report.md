# M4 Task 3 report: Docker Compose stack

Files: docker-compose.yml, .env.example, fairmatch/tests/test_compose_file.py (11 tests), header comment in fairmatch/docker-compose.dev.yml. pyyaml was already in requirements-dev.txt.

Design: services postgres (pgvector/pgvector:pg16, named volume pgdata, pg_isready), redis (7-alpine, redis-cli ping), migrate (alembic upgrade head, restart "no"), api, worker (celery, concurrency 2), web (only published port, ${WEB_PORT:-8080}:8080, waits for api healthy). A shared env anchor gives migrate, api and worker JWT_SECRET (`${JWT_SECRET:?...}`, required by entrypoint.sh in every backend container), DATABASE_URL (password via `${POSTGRES_PASSWORD:?...}`), REDIS_URL, ACCESS_TOKEN_MINUTES, OPENAI_API_KEY. api and worker wait for migrate completed plus postgres and redis healthy.

Verification:
- pytest tests/test_compose_file.py: 11 passed. Full suite (not slow/llm/db): 311 passed. ruff: clean.
- `docker compose --env-file .env.example config -q` works without the daemon: valid (exit 0). The CI dummy .env uses the same keys.
- Honest note: tests and files were written together, so the red step was not observed.
- Not run (daemon off): build, up, health, end-to-end.

Commands for the user:
    cp .env.example .env   # set JWT_SECRET and POSTGRES_PASSWORD
    docker compose up -d --build
    curl -s localhost:8080/api/health
    docker compose run --rm api python -m api.cli create-admin EMAIL PASSWORD
    # register a user, upload a resume, start a run to done in the UI
    docker compose down
Check: without .env, `docker compose up` must stop with "set JWT_SECRET in .env".
