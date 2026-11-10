# M4 audit trail report

- Backend: `requested_by_email` (str | None) on RunSummaryOut/RunOut, resolved with one batched lookup of `users` per list page (None when the user row is gone); admin-only as before. openapi.json and schema.d.ts regenerated. 3 new tests in tests/api/test_runs.py (list+detail, deleted user, candidate 403 with no email leak).
- Frontend: new `components/AuditTrail.tsx` (plain text; run id, algorithm, status, started by, created/started/finished, duration, error, fairness-skipped reason, note on contents) on RunDetail; Started by column in Runs. Naive UTC timestamps go through existing `formatTimestamp`. 4 new vitest tests (full render, null email, failed run, list column); two existing assertions scoped because the text now also appears in the audit trail.
- E2E: flow 3 asserts admin email, skipped reason and no Invalid Date inside the Audit trail region.
- nginx: gzip on, gzip_vary on, gzip_types css/js/json/svg; new static check in nginx.test.mjs; CSP check still green.
- Docs: README, ARCHITECTURE (new Audit trail section, gzip), DEPLOYMENT, frontend/README updated; limitation reworded: weights, input snapshots and later edits are not recorded.
- Verification: pytest 328 passed; ruff clean; openapi up to date; vitest 380 passed; typecheck, lint, build, test:deploy ok; e2e 7/7. NUL scan clean. Ports 5173/8765 free.
