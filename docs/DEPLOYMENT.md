# Deployment

Back to the [README](../README.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

Verification status: the Docker files are checked by static tests (`fairmatch/tests/test_docker_files.py`, `test_compose_file.py`, `test_ci_workflow.py`, `frontend/deploy/nginx.test.mjs`) and by the `docker` CI job (`docker compose build`, `docker compose config -q`). The stack has not been started end to end by the author (Docker daemon off), so none of the runtime behaviour below has been observed in a running container.

## Services (`docker-compose.yml`)

| Service | Image | Role |
|---|---|---|
| `postgres` | `pgvector/pgvector:pg16` | Database; named volume `pgdata`; healthcheck `pg_isready` |
| `redis` | `redis:7-alpine` | Celery broker/result backend, embedding cache; healthcheck `redis-cli ping` |
| `migrate` | backend image | One-shot `alembic upgrade head` (`restart: "no"`) |
| `api` | backend image (`fairmatch/Dockerfile`) | uvicorn on internal port 8000; image health check on `/health` |
| `worker` | backend image | `celery -A api.worker:celery_app worker --concurrency=2` |
| `web` | `frontend/Dockerfile` (nginx-unprivileged) | Serves the SPA and proxies `/api/`; the only published port, `${WEB_PORT:-8080}:8080` |

`api` and `worker` wait for `migrate` to complete successfully and for `postgres` and `redis` to be healthy; `web` waits for `api` to be healthy. Containers run as a non-root user. The embedding model is downloaded when the backend image is built and loaded offline at runtime, so the first request does not need internet access.

## Configuration

Set these in `.env` (copy `.env.example`). `.env` is git-ignored.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | yes | none | Signs access tokens. `.env.example` ships it empty on purpose: compose refuses to start until you set it, and the backend entrypoint also exits if it is empty |
| `POSTGRES_PASSWORD` | yes | none | Password of the `fairmatch` database user; compose refuses to start without it. Must be URL-safe (`A-Za-z0-9_-`, e.g. from `secrets.token_urlsafe`) because it is embedded in `DATABASE_URL` |
| `OPENAI_API_KEY` | no | empty | Enables LLM parsing and narratives; empty means regex/spaCy parsing and deterministic explanations |
| `WEB_PORT` | no | `8080` | Host port of the web tier |
| `ACCESS_TOKEN_MINUTES` | no | `60` | Access token lifetime |

Backend settings that compose does not pass through (set them under `environment:` if you need them): `OPENAI_MODEL` (default `gpt-4o-mini`), `RUN_TIMEOUT_MINUTES` (30), `PENDING_GRACE_MINUTES` (5), `CELERY_EAGER` (false). `DATABASE_URL` and `REDIS_URL` are set by compose to the internal `postgres` and `redis` services.

Generate a secret: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

## Operations

```bash
docker compose up --build -d                  # start (builds on first run)
docker compose logs -f api worker             # follow logs
docker compose run --rm api python -m api.cli create-admin EMAIL PASSWORD
docker compose down                           # stop, keep data
docker compose down -v                        # stop and DELETE the database volume
```

These commands are the same in PowerShell. Quote a password containing shell metacharacters.

Health check (once up): `curl -s http://localhost:8080/api/health` should return `{"status":"ok"}`. This has not been observed by the author.

### Data and backup

All state is in the `pgdata` volume (Redis holds only the queue and cache). Back up with `pg_dump` through the container, for example:

```bash
docker compose exec -T postgres pg_dump -U fairmatch fairmatch > fairmatch-backup.sql
docker compose exec -T postgres psql -U fairmatch fairmatch < fairmatch-backup.sql   # restore into an empty DB
```

(PowerShell: use `cmd /c` for the redirections, or `docker compose exec -T postgres pg_dump -U fairmatch fairmatch | Set-Content -Encoding utf8 fairmatch-backup.sql`.) The restore command is untested.

### Upgrading and migrations

`git pull`, then `docker compose up --build -d`. `migrate` runs `alembic upgrade head` on every `up`; on an up-to-date database it changes nothing. The password in `POSTGRES_PASSWORD` is only applied when the volume is first created; changing it later requires changing the database user's password too.

### Security notes

- Put TLS in front of `web` (a reverse proxy or load balancer terminating HTTPS). The stack itself speaks plain HTTP.
- Rotating `JWT_SECRET` invalidates every existing session; users sign in again.
- Uploads are limited to 5 MiB by the API and `client_max_body_size 6m` in nginx, which rejects larger bodies before they reach the API.
- nginx sends a Content-Security-Policy (`default-src 'self'`, no `unsafe-eval`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a restrictive `Permissions-Policy`.
- Only `web` publishes a port; `api`, `postgres` and `redis` are reachable only on the compose network. The development file `fairmatch/docker-compose.dev.yml` does publish PostgreSQL and Redis with a throwaway password and must not be used for deployment.
- Registered users are always candidates; create admins only with the CLI.

## CI (`.github/workflows/ci.yml`)

On push and pull request to `main` or `master`: `backend` (ruff, pytest without slow/llm/db markers, OpenAPI snapshot check, then `pytest -m db` against a `pgvector/pgvector:pg16` service), `frontend` (lint, typecheck, test, build, `test:deploy`), `e2e` (Playwright with the real backend) and `docker` (`docker compose build` with a dummy `.env`, then `docker compose config -q`). The workflow has read-only permissions and uses no secrets. It has not been run until the repository is pushed.

## Known limitations

- No audit-trail view: the dashboard shows run history, allocations, fairness and explanations per run, but not who requested a run or the scoring weights.
- PostgreSQL and pgvector behaviour is verified offline and by the `pytest -m db` CI job only; everyday local tests use SQLite and an in-memory Redis fake.
- The Docker path is verified by static tests and the CI image build only.
- Education detection on the no-API-key path uses regular expressions with edge cases (unusual spellings of degrees can be missed or misread).
- Without the nginx proxy (for example `uvicorn` exposed directly), the multipart parser receives and spools an oversized upload to disk before the API's 5 MiB check rejects it. The compose stack avoids this through nginx's body limit.
- Stuck runs are reclaimed at worker start and by a sweep every 5 minutes (embedded celery beat, `-B`), but there is no liveness heartbeat: a legitimate run longer than `RUN_TIMEOUT_MINUTES` (default 30) can be taken over and executed twice (on PostgreSQL the loser can fail on the unique allocation constraint). Raise `RUN_TIMEOUT_MINUTES` for very large runs.
- Run status is polled (1.5 s); there is no push channel.
- A run is limited to `candidates x total seats <= 25,000,000`, and an opportunity's capacity to 10000.
- Fairness is measured on a single group label per candidate and only describes selection rates (see [FAIRNESS.md](FAIRNESS.md)).
