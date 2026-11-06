# Milestone 4 fix round report

Source: docs/superpowers/reports/m4-judge-1.md.

## Fixed
- F1: `.env.example` ships `JWT_SECRET=` and `POSTGRES_PASSWORD=` empty (compose `:?` refuses to start); generator one-liner in the comment. Test asserts both are empty.
- F21: frontend CI job runs `npx playwright install --with-deps chromium` before `test:deploy` (test asserts order).
- F22: e2e job sets `HF_HOME=$workspace/.hf-cache`, restores it with `actions/cache@v4`, runs `scripts/prefetch_model.py` before `npm run e2e`; the offline backend inherits the same `HF_HOME`. Test asserts the cache path equals `HF_HOME` and the prefetch precedes e2e.
- F2: `healthcheck: disable: true` on `worker` and `migrate` (tested).
- F10: `pg_isready -h 127.0.0.1 ...` (tested).
- F13: new Celery task `api.reclaim_stuck`, `beat_schedule` every 300 s, worker started with `-B`; `worker_ready` handler kept (both share `_reclaim_and_enqueue`). Tests for schedule, enqueue, error swallowing, `-B`. Documented in ARCHITECTURE.md and DEPLOYMENT.md.
- F11: `.env.example`, compose header comment, README, DEPLOYMENT.md state POSTGRES_PASSWORD must be `[A-Za-z0-9_-]`; test checks the note exists.
- F3: `**/__pycache__`, `**/*.pyc`, `**/*.db|sqlite|sqlite3` in fairmatch/.dockerignore (tested).
- F4: `.gitattributes` adds `*.sh`, `Dockerfile`, `*.conf`, `*.yml` with `text eol=lf`.
- F12: migrate/api/worker share `image: fairmatch-backend:local` (tested).
- F14: reclaim uses a guarded `UPDATE ... WHERE status='running' AND (started_at IS NULL OR started_at < cutoff)` and checks rowcount; race test interleaves a concurrent claim.
- F18: test renamed to the naive case; added real aware-UTC `started_at` and aware non-UTC `now` tests.
- F19: `hookTimeout: 30_000` in vite.config.ts.
- F25: tests assert the real entrypoint JWT check (`if [ -z "${JWT_SECRET:-}" ]; then` + `exit 1`) and the postgres healthcheck command; the `change-me` assertion was replaced with the empty-value assertion.
- F26: frontend/.dockerignore adds `.env*`, `*.log`, `coverage`.
- F15: documented as a limitation in DEPLOYMENT.md (no heartbeat; long runs can be double-executed).

## Skipped (as instructed)
F5, F6, F7, F8, F9, F16, F17, F20, F23, F24.

## Verification
- Backend `pytest -m "not slow and not llm and not db"`: 324 passed (run before the final two F18 test edits; the four touched test files re-run afterwards: 51 passed). ruff clean, openapi `--check` up to date.
- `docker compose --env-file .env.example config` now fails with the JWT_SECRET message (intended); with dummy values it resolves.
- Frontend results: see the final summary message.
