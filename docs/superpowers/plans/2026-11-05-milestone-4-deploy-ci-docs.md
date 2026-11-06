# FairMatch AI Milestone 4: Docker, CI and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can clone the repo and run the whole product with `docker compose up`, every push is verified by GitHub Actions, and the project is documented for a reader who has never seen it.

**Architecture:** One backend image (FastAPI, Celery worker and migrations share it, different commands) and one web image (nginx serving the built SPA and reverse-proxying `/api/` to the API, stripping the prefix exactly as the Vite dev proxy does). Compose wires `postgres` (pgvector), `redis`, `migrate` (one-shot `alembic upgrade head`), `api`, `worker`, `web`. Only `web` publishes a port. Stuck runs are reclaimed by the worker. CI mirrors the local commands.

**Tech Stack:** Docker, Docker Compose v2, nginx (unprivileged), pgvector/pgvector:pg16, redis:7, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-02-fairmatch-design.md` (deployment and quality sections). Context: `docs/superpowers/plans/2026-11-03-milestone-2-database-and-api.md`, `docs/superpowers/plans/2026-11-04-milestone-3-dashboard.md`, judge reports in `docs/superpowers/reports/` (m3-judge-final.md lists the carried-over items used below).

## Global Constraints

- Mainstream tooling only: Docker, Compose, nginx, GitHub Actions official actions (`actions/checkout`, `actions/setup-python`, `actions/setup-node`, `docker/build-push-action` only if needed). No Kubernetes, Terraform or extra services.
- Python 3.13 and Node 22 (matches the machine that built the project; Node floor 20).
- Port 8000 on the developer machine belongs to an unrelated program; compose publishes the web tier on host port `8080` (configurable via `WEB_PORT`) and never publishes `api`, `postgres` or `redis`.
- No secret is committed. `JWT_SECRET` has no default in compose (`${JWT_SECRET:?set JWT_SECRET in .env}`); `.env.example` holds placeholders only. Images contain no secrets; containers run as non-root.
- The API error shape stays `{"detail": str}`; the OpenAPI snapshot (`fairmatch/openapi.json`) must be regenerated and committed when the API changes (`python scripts/export_openapi.py --check` passes).
- The embedding model `BAAI/bge-small-en-v1.5` is downloaded at image build time and loaded offline at runtime (the code loads `local_files_only=True` first, online fallback second).
- Uploads are limited to 5 MiB by the API; nginx must reject larger bodies earlier (`client_max_body_size 6m`) so large uploads never reach disk.
- All existing suites keep passing: backend `pytest -m "not slow and not llm and not db" -q` and `ruff check .` from `fairmatch/`; frontend `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e` from `frontend/`.
- Docker Desktop is off on the developer machine: tasks must be verifiable without a running Docker daemon (static tests that parse the files) and each lists a `docker`-based check as an extra that may be reported as "not run" with the reason. Never claim an image was built unless it was.
- Commands run from the repo root unless stated.

## Review Focus

- `docker compose up` on a machine with no `.env`: must stop with the clear `set JWT_SECRET in .env` message, not start an insecure API.
- Cold start ordering: `api` and `worker` must wait for `migrate` to finish successfully and for `postgres`/`redis` to be healthy; a slow Postgres must not crash-loop the API.
- Browser refresh on a deep link (`/runs/3`) must serve the SPA, while a missing `/assets/x.js` must be a real 404 (not `index.html`).
- A 20 MiB upload through nginx must get a 413 with a JSON-free but clean response and nothing written by the API.
- A run whose worker was killed mid-way (`running`, `started_at` older than the timeout) must be reclaimed and finish, and a fresh `running` run must not be double-executed.
- A run created but never enqueued (`pending` for longer than the grace period) must be picked up when a worker starts.
- Restarting the stack must keep the database (named volume) and re-running `migrate` on an up-to-date DB must be a no-op.

## Execution Order

Wave A in parallel (disjoint files): Task 1, Task 2, Task 4, Task 5, Task 6. Then Task 3 (needs 1 and 2). Then Task 7 (docs, needs all). A judge pass after Wave A and a final judge after Task 7.

---

### Task 1: Backend container image

**Files:**
- Create: `fairmatch/Dockerfile`, `fairmatch/.dockerignore`, `fairmatch/docker/entrypoint.sh`, `fairmatch/scripts/prefetch_model.py`
- Create: `fairmatch/tests/test_docker_files.py`
- Modify: `fairmatch/requirements.txt` (split so the image installs runtime deps only): create `fairmatch/requirements-dev.txt` containing `-r requirements.txt` plus `pytest`, `ruff`, `fakeredis`, `httpx`; remove those four from `requirements.txt`.

**Interfaces:**
- Produces: image built from `fairmatch/` context. `CMD` default runs the API: `uvicorn api.main:create_app --factory --host 0.0.0.0 --port 8000`. The worker runs `celery -A api.worker:celery_app worker --loglevel=INFO --concurrency=2`. The migration runs `alembic upgrade head`. Env consumed: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, optional `OPENAI_API_KEY`. Model cache in `HF_HOME=/opt/hf`.

- [ ] **Step 1: Write failing static tests** in `tests/test_docker_files.py`: `test_dockerfile_non_root` (a `USER` line that is not `root`), `test_dockerfile_runs_prefetch` (references `scripts/prefetch_model.py`), `test_dockerignore_excludes_secrets` (contains `.env`, `*.db`, `.venv`, `__pycache__`, `tests`), `test_runtime_requirements_exclude_dev_tools` (`pytest`, `ruff`, `fakeredis` absent from `requirements.txt`, present via `requirements-dev.txt`), `test_entrypoint_is_exec_form` (uses `exec "$@"`).
- [ ] **Step 2: Run** `pytest tests/test_docker_files.py -v` from `fairmatch/`. Expected: FAIL (files missing).
- [ ] **Step 3: Create the files.** Dockerfile: `python:3.13-slim`, two-stage (builder installs wheels, final copies them), `ENV PYTHONUNBUFFERED=1 HF_HOME=/opt/hf`, runs `python scripts/prefetch_model.py` at build as root then `chown`, creates user `app` (uid 10001), `USER app`, `WORKDIR /app`, copies `api core migrations scripts alembic.ini openapi.json sample_data`, `HEALTHCHECK` using `python -c` to GET `http://127.0.0.1:8000/health`. `prefetch_model.py`: instantiates `SentenceTransformerEmbedder` online once and encodes one string; exits non-zero on failure. `entrypoint.sh`: `set -eu`, refuses to start if `JWT_SECRET` is empty (clear message), then `exec "$@"`.
- [ ] **Step 4: Run** `pytest tests/test_docker_files.py -v` and `ruff check .`. Expected: PASS, clean. Also run the full backend suite to confirm the requirements split broke nothing (`pip install -r requirements-dev.txt` is a no-op here).
- [ ] **Step 5 (extra, only if the Docker daemon is running):** `docker build -t fairmatch-api fairmatch` and `docker run --rm -e JWT_SECRET= fairmatch-api` exits non-zero with the message. Otherwise report "not run: Docker daemon off".
- [ ] **Step 6: Commit** `feat(deploy): backend image with offline model cache, non-root, health check`.

---

### Task 2: Web image (nginx + SPA)

**Files:**
- Create: `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/deploy/nginx.conf`
- Create: `frontend/deploy/nginx.test.mjs` (a node script test, run by `npm run test:deploy`) and add the script to `frontend/package.json`.

**Interfaces:**
- Consumes: the Vite build output `frontend/dist` (`npm run build`).
- Produces: image serving on container port `8080` (nginx-unprivileged), upstream `api:8000`. Locations: `/api/` proxied with the prefix stripped (`proxy_pass http://api:8000/;`), `/assets/` served with `Cache-Control: public, max-age=31536000, immutable` and `try_files $uri =404`, everything else `try_files $uri /index.html` with `Cache-Control: no-cache`. `client_max_body_size 6m;` `proxy_read_timeout 60s`. Headers on every response: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `server_tokens off`.

- [ ] **Step 1: Write the failing test** `deploy/nginx.test.mjs`: reads `nginx.conf` and asserts each directive above is present exactly (regex per directive), that `proxy_pass` ends in `/` (prefix stripping), that `/assets/` uses `=404`, and that the CSP has no `unsafe-eval` and no `*`.
- [ ] **Step 2: Run** `npm run test:deploy`. Expected: FAIL (file missing).
- [ ] **Step 3: Create** `nginx.conf`, a two-stage `Dockerfile` (`node:22-alpine` build with `npm ci`, then `nginxinc/nginx-unprivileged:stable-alpine` copying `dist` and the conf), `.dockerignore` (`node_modules`, `dist`, `e2e`, `test-results`, `playwright-report`).
- [ ] **Step 4: Run** `npm run test:deploy`, `npm run build`, `npm run lint`. Expected: PASS. Check the built app still works under the CSP: serve `dist` with the headers via a tiny local node static server in the test (`deploy/nginx.test.mjs` may spawn it) and load `/` in Playwright's Chromium with the CSP applied; fail on any `console.error` or CSP violation. (Recharts uses inline styles, which `style-src 'unsafe-inline'` allows; the check proves nothing else is blocked.)
- [ ] **Step 5 (extra, daemon only):** `docker build -t fairmatch-web frontend`. Otherwise report "not run".
- [ ] **Step 6: Commit** `feat(deploy): nginx web image with SPA fallback, API proxy, upload limit and security headers`.

---

### Task 3: Docker Compose stack

**Files:**
- Create: `docker-compose.yml` (repo root), `.env.example` (repo root), `fairmatch/tests/test_compose_file.py`
- Modify: `fairmatch/docker-compose.dev.yml` (leave as the dev-only DB/Redis helper; add a header comment pointing to the root file).

**Interfaces:**
- Consumes: images from Tasks 1 and 2 (`build: ./fairmatch` and `build: ./frontend`).
- Produces: services `postgres`, `redis`, `migrate`, `api`, `worker`, `web`. `.env.example` keys: `JWT_SECRET`, `POSTGRES_PASSWORD`, `OPENAI_API_KEY` (optional, empty), `WEB_PORT=8080`, `ACCESS_TOKEN_MINUTES=60`.

- [ ] **Step 1: Write failing tests** in `test_compose_file.py` (parse YAML with `yaml.safe_load`; add `pyyaml` to `requirements-dev.txt`): `test_only_web_publishes_a_port`, `test_jwt_secret_has_no_default` (value starts with `${JWT_SECRET:?`), `test_api_and_worker_wait_for_migrate_completed` (`depends_on.migrate.condition == service_completed_successfully`), `test_postgres_and_redis_have_healthchecks_and_dependents_wait_healthy`, `test_postgres_uses_named_volume`, `test_database_url_targets_postgres_service` (`postgresql+psycopg://` and host `postgres`), `test_redis_url_targets_redis_service`, `test_no_secret_literals` (no value equal to `fairmatch` password literals; password via `${POSTGRES_PASSWORD:?...}`), `test_env_example_has_every_required_key_and_no_real_secret`.
- [ ] **Step 2: Run** `pytest tests/test_compose_file.py -v`. Expected: FAIL.
- [ ] **Step 3: Write** `docker-compose.yml` and `.env.example`. `postgres`: `pgvector/pgvector:pg16`, healthcheck `pg_isready`, volume `pgdata`. `redis`: `redis:7-alpine`, healthcheck `redis-cli ping`. `migrate`: backend image, command `alembic upgrade head`, `restart: "no"`. `api` and `worker`: backend image, shared env anchor, worker command per Task 1, `restart: unless-stopped`. `web`: web image, `ports: ["${WEB_PORT:-8080}:8080"]`, `depends_on: api healthy`. Create-admin command documented in Task 7 (`docker compose run --rm api python -m api.cli create-admin ...`, check the real CLI usage in `api/cli.py` first).
- [ ] **Step 4: Run** the new tests and the full backend suite. Expected: PASS.
- [ ] **Step 5 (extra, daemon only):** `docker compose config` with a dummy `.env` is valid; `docker compose up -d --build`, then `curl -s localhost:8080/api/health` returns `{"status":"ok"}`, register a user, upload a resume, start a run to `done`, `docker compose down`. Otherwise report "not run: Docker daemon off" and list the exact commands for the user.
- [ ] **Step 6: Commit** `feat(deploy): docker compose stack (postgres+pgvector, redis, migrate, api, worker, web)`.

---

### Task 4: Reclaim stuck runs

**Files:**
- Modify: `fairmatch/api/models.py` (`AllocationRun.started_at: Mapped[datetime | None]`), `fairmatch/api/config.py` (`run_timeout_minutes: int = 30`, `pending_grace_minutes: int = 5`), `fairmatch/api/services/runs.py`, `fairmatch/api/worker.py`, `fairmatch/openapi.json`, `fairmatch/README.md` (limitation removed)
- Create: `fairmatch/migrations/versions/0002_run_started_at.py`, `fairmatch/tests/api/test_reclaim.py`
- Modify: frontend only if the generated `schema.d.ts` changes: run `npm run gen:api` in `frontend/` and keep `npm test` green (do not otherwise edit frontend files; Task 5 owns them: coordinate by only touching `src/api/schema.d.ts`).

**Interfaces:**
- Produces in `api/services/runs.py`: `def reclaim_stuck_runs(session: Session, now: datetime | None = None) -> list[int]` returns the ids it re-queued/marked. Behavior: runs `running` with `started_at` older than `run_timeout_minutes` are set back to `pending` (their `started_at`/`error` cleared) and returned for re-enqueue; runs `pending` with `created_at` older than `pending_grace_minutes` are returned for re-enqueue. `execute_run` sets `started_at = now` when it claims, and its claim query also accepts `running` rows whose `started_at` is older than the timeout (so a dead worker's run can be taken over without double-executing a fresh one). `RunOut` gains `started_at: datetime | None`.
- Produces in `api/worker.py`: on `worker_ready` signal, open a session, call `reclaim_stuck_runs`, enqueue `run_allocation.delay(id)` for each. Never raises.

- [ ] **Step 1: Write failing tests** in `test_reclaim.py` (use the existing `tests/api` fixtures; pass `now` explicitly): `test_running_older_than_timeout_is_reclaimed`, `test_fresh_running_run_is_left_alone`, `test_old_pending_run_is_returned_for_enqueue`, `test_recent_pending_run_is_left_alone`, `test_execute_run_sets_started_at`, `test_execute_run_takes_over_expired_running_run`, `test_execute_run_ignores_fresh_running_run` (still returns without doing work), `test_done_and_failed_runs_never_reclaimed`, `test_worker_ready_handler_swallows_errors`, `test_migration_0002_adds_started_at` (alembic upgrade on a temp SQLite DB, then downgrade).
- [ ] **Step 2: Run** `pytest tests/api/test_reclaim.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the model column, migration `0002` (nullable `started_at`; downgrade drops it; SQLite-safe via `batch_alter_table`), settings, the service function and the worker signal handler as specified in Interfaces. Regenerate the snapshot: `python scripts/export_openapi.py`, then `npm run gen:api` in `frontend/`.
- [ ] **Step 4: Run** the full backend suite, `ruff check .`, `python scripts/export_openapi.py --check`, then in `frontend/` `npm run typecheck` and `npm test`. Expected: all pass. Scan changed files for NUL bytes.
- [ ] **Step 5: Commit** `feat(api): reclaim stuck and never-enqueued runs; add run started_at`.

---

### Task 5: Frontend hardening (carried over from the M3 judge)

**Files:**
- Modify: `frontend/src/App.tsx` (or wherever routes are declared; find with Grep), `frontend/vite.config.ts`, `frontend/package.json`, `frontend/package-lock.json`
- Create: `frontend/src/App.lazy.test.tsx`, `frontend/vite.config.test.ts`

**Interfaces:**
- Produces: route-level code splitting: admin pages (opportunities, runs, run detail, comparison charts) and `recharts` load through `React.lazy` behind a single `<Suspense>` fallback with `role="status"` text "Loading…"; the main entry chunk is under 400 kB (`npm run build` output). Vite config validates `VITE_API_TARGET` with `new URL()` and throws `VITE_API_TARGET must be an absolute http(s) URL` otherwise (export a pure helper `resolveApiTarget(value: string | undefined): string` for testing).

- [ ] **Step 1: Write failing tests:** `vite.config.test.ts`: `resolveApiTarget(undefined)` is `http://127.0.0.1:8000`; `"http://api:8000"` passes through; `"api:8000"`, `"garbage"` and `"ftp://x"` throw. `App.lazy.test.tsx`: rendering the admin runs route shows the "Loading…" status first and then the page heading (use the existing MSW setup and the project's routing test helpers).
- [ ] **Step 2: Run** `npm test -- vite.config App.lazy`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper and the lazy routes. Run `npm audit fix` for the dev-only moderate findings only if it changes no direct dependency major version; otherwise leave and note why. Add the PowerShell form of any new env vars to the docs you touch.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (record chunk sizes) and `npm run e2e`. Expected: all pass, 7/7 e2e, main chunk under 400 kB. No leftover `fairmatch-e2e-*` temp dirs, ports 5173 and 8765 free, port 8000 untouched.
- [ ] **Step 5: Commit** `perf(frontend): lazy admin routes and validated API target`.

---

### Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`, `fairmatch/tests/test_ci_workflow.py`
- Modify: `frontend/playwright.config.ts` (browser selection), `.gitattributes` only if line-ending churn shows up in CI diffs.

**Interfaces:**
- Produces: workflow `CI` on `push` and `pull_request` to `main` and `master`, `concurrency` cancelling superseded runs, `permissions: contents: read`. Jobs: `backend` (Python 3.13, pip cache, `pip install -r requirements-dev.txt`, `ruff check .`, `pytest -m "not slow and not llm and not db" -q`, `python scripts/export_openapi.py --check`; then a Postgres service `pgvector/pgvector:pg16` and `TEST_DATABASE_URL=postgresql+psycopg://...` running `pytest -m db -v`), `frontend` (Node 22, `npm ci`, `lint`, `typecheck`, `test`, `build`, `test:deploy`), `e2e` (needs backend deps and `npx playwright install --with-deps chromium`, then `npm run e2e`, uploads `playwright-report` on failure), `docker` (`docker compose build` with a dummy `.env` generated in the job, then `docker compose config -q`). All third-party actions pinned to a major version tag.
- `playwright.config.ts`: use `E2E_CHROMIUM_PATH` only when set (still throws if missing, existing behavior); otherwise use the default bundled browser (remove the hard-coded `chromium-1248` path), so CI and fresh clones work. Locally on this machine set `E2E_CHROMIUM_PATH` to the existing Chromium and document that in `frontend/e2e/README.md`.

- [ ] **Step 1: Write failing tests** in `test_ci_workflow.py` (YAML parse): `test_workflow_triggers_on_push_and_pr`, `test_jobs_present` (`backend`, `frontend`, `e2e`, `docker`), `test_permissions_are_read_only`, `test_actions_are_version_pinned` (every `uses:` has `@v<N>` or a SHA), `test_backend_runs_ruff_pytest_and_openapi_check`, `test_db_tests_use_pgvector_service`, `test_no_secrets_referenced_except_none` (no `secrets.` usage), `test_playwright_config_has_no_hardcoded_browser_path` (read the TS file, assert no `chromium-` literal).
- [ ] **Step 2: Run** `pytest tests/test_ci_workflow.py -v`. Expected: FAIL.
- [ ] **Step 3: Write** the workflow and edit the Playwright config.
- [ ] **Step 4: Run** the new tests, then the full backend suite, then `E2E_CHROMIUM_PATH=<existing chromium> npm run e2e` locally: 7/7. Expected: PASS. Also validate the workflow YAML parses and the `pytest -m db` command is exactly what CI runs (the real run happens on GitHub; report "CI itself not exercised until pushed").
- [ ] **Step 5: Commit** `ci: GitHub Actions for backend, frontend, e2e and docker build`.

---

### Task 7: Documentation

**Files:**
- Create: `README.md` (repo root), `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/FAIRNESS.md`
- Modify: `fairmatch/README.md`, `frontend/README.md` (link up to root, remove now-false limitations)

**Interfaces:** documentation only; every command shown must be run literally and pass (or be marked as Docker-only/not run).

- [ ] **Step 1: Write** the root `README.md`: what FairMatch is (one paragraph), architecture diagram (mermaid), quick start with Docker (`cp .env.example .env`, set `JWT_SECRET` with a one-line generator, `docker compose up --build`, create the first admin, open `http://localhost:8080`), local development without Docker (backend, frontend, tests, e2e on Windows PowerShell and POSIX), repo map, CI badge placeholder using the real repo URL `https://github.com/Sejal-07661/fairmatch-ai`.
- [ ] **Step 2: Write** `docs/ARCHITECTURE.md` (pipeline: parse, embed, score, Hungarian vs Gale-Shapley, fairness audit, explanations; DB schema; Celery flow; auth and roles; privacy rule: demographics reach only `fairness.audit`; how stuck runs are reclaimed), `docs/DEPLOYMENT.md` (env var table with required/optional/default, volumes and backup of `pgdata`, upgrading and migrations, TLS note: terminate TLS in front of `web`, rotating `JWT_SECRET` invalidates sessions, upload limit, known limitations list including that PostgreSQL tests run in CI and that the audit-trail view is not built), `docs/FAIRNESS.md` (metrics: selection rate, disparate impact with the four-fifths rule, parity difference; what they do and do not prove; the dataset used by the demo).
- [ ] **Step 3: Verify literally:** every code block command in the READMEs that can run here is run (backend tests, frontend tests, `docker compose config` if available) and the doc is corrected where it fails. Check all relative links resolve (a small script or Grep), and that no doc claims something the code does not do (spot-check three claims against the source).
- [ ] **Step 4: Commit** `docs: root README, architecture, deployment and fairness guides`.

---

## Self-Review

- Spec coverage: Docker Compose (Tasks 1-3), CI (6), docs (7), carried-over items: stuck-run reclaim (4), reverse-proxy upload limit and security headers (2), chunk splitting and env validation (5), PostgreSQL test run (6, in CI), dev audit findings (5). Optional email format check is dropped (YAGNI, noted in the final summary). No dedicated audit-trail view: documented as a known limitation in Task 7, not built.
- Types: `reclaim_stuck_runs(session, now=None) -> list[int]`, `resolveApiTarget(value) -> string`, settings `run_timeout_minutes` and `pending_grace_minutes` are used with the same names in Tasks 4 and 7.
- Verification honesty: Tasks 1-3 are verified by static tests without Docker; the daemon-based checks are listed as extras and must be reported as "not run" if Docker is off.
- File ownership: Task 4 touches only `frontend/src/api/schema.d.ts` in the frontend; Task 5 owns the rest; Task 6 owns `playwright.config.ts` and `frontend/e2e/README.md`; Task 5 and Task 2 both edit `frontend/package.json` (different keys: Task 5 dependencies/lock, Task 2 the `test:deploy` script), so run Task 2 and Task 5 sequentially or have the second one rebase on the first.
