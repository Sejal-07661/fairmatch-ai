# M2 Task 6: Allocation runs

Files: fairmatch/api/services/runs.py, api/routers/runs.py, tests/api/test_runs.py; appended schemas, run_allocation task in worker.py, include_router in main.py.

Decisions
- POST /runs commits the run row before run_allocation.delay. If delay raises: run marked failed (error set), response 503 {"detail": ...}.
- Claim is an atomic UPDATE ... WHERE status IN (pending, failed); rowcount != 1 returns without writing. Re-run deletes prior Allocation rows. Any exception (incl. NaN/inf, core ValueError) -> failed, error[:500], not re-raised.
- Size guard: candidates * total seats > MAX_CELLS (25_000_000) -> 422 stating the limit.
- group_of only when every candidate has demographics; otherwise metrics.fairness_skipped. Fairness JSON (admin-only) contains group names; explanations/errors/logs never do.
- Pending/running/failed runs return empty allocations/explanations (only done runs expose rows).
- 21 tests in test_runs.py; idempotency tested sequentially.
