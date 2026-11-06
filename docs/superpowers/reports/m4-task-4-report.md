# M4 Task 4: Reclaim stuck runs

Implemented: `AllocationRun.started_at`, migration 0002 (batch_alter_table, SQLite-safe, tested up/down), settings `run_timeout_minutes=30` / `pending_grace_minutes=5`, `reclaim_stuck_runs(session, now=None)`, `execute_run` sets `started_at` and can take over expired `running` rows, `worker_ready` handler (never raises), `RunSummaryOut`/`RunOut` gain `started_at`, openapi.json and schema.d.ts regenerated, README limitation line removed. Also touched `api/schemas.py` (needed for RunOut).

Datetimes: columns are naive UTC. `_naive_utc()` normalises any input (aware or naive) before comparing or writing `started_at`, so SQL and Python comparisons never mix aware/naive.

Verification: backend 300 passed; 12 new tests pass; openapi --check ok; frontend `npm test` 370 passed.
Caveats:
- Implementation was written before the tests were run red (TDD order not strictly followed).
- `ruff check .` reports 1 error (BLE001) in `scripts/prefetch_model.py` (Task 1 file, not mine).
- `npm run typecheck` FAILS: `frontend/src/test/fixtures.ts` `makeRun()` lacks `started_at: null` (Task 5 owns it; one-line fix). I did not edit it.
- No NUL bytes found in changed files.
