# M4 Task 6: GitHub Actions CI

Files: `.github/workflows/ci.yml`, `fairmatch/tests/test_ci_workflow.py` (9 static tests, written first, failed, now pass), `frontend/playwright.config.ts` (hard-coded chromium-1248 path removed; `E2E_CHROMIUM_PATH` used only when set, throws if missing, else bundled browser), `frontend/e2e/README.md` (documents the variable, PowerShell and POSIX).

Verification: new tests 9/9; ruff clean on the new test; backend `pytest -m "not slow and not llm and not db"` 300 passed; `npm run e2e` with E2E_CHROMIUM_PATH set to the existing Chromium: 7/7. Ports 5173/8765 free, no fairmatch-e2e-* dirs left. CI itself not exercised until pushed.

Notes for other tasks:
- `requirements-dev.txt` (Task 1) must include `pyyaml` (tests import `yaml`); installed locally via pip only.
- The workflow references not-yet-existing items: `requirements-dev.txt`, `npm run test:deploy`, root `docker-compose.yml`; the docker job writes a dummy root `.env` (JWT_SECRET, POSTGRES_PASSWORD, OPENAI_API_KEY, WEB_PORT, ACCESS_TOKEN_MINUTES).
- The db job assumes `pytest -m db` reads `TEST_DATABASE_URL` (postgresql+psycopg://fairmatch:fairmatch-ci@localhost:5432/fairmatch_test).
