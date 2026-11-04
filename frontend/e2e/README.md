# End-to-end tests

Playwright drives the real dashboard against the real FastAPI backend (no mocks).

Run: `npm run e2e` from `frontend/`. Needs `python` (with the `fairmatch/` requirements installed) on PATH, or set `E2E_PYTHON`.

- Backend: uvicorn on **127.0.0.1:8765** (never 8000), SQLite file in a temp dir, `CELERY_EAGER=true`, `REDIS_URL=fakeredis://`, `HF_HUB_OFFLINE=1`, no `OPENAI_API_KEY`.
- Frontend: Vite dev server on 5173 with `--strictPort` (fails if busy) and `VITE_API_TARGET=http://127.0.0.1:8765`.
- Fresh DB per run: `fairmatch/scripts/e2e_prepare.py` creates tables and the admin `admin@example.com` / `E2e-Passw0rd!`. The temp dir is removed on teardown and again on exit.
- Global setup warms the embedding model (about 30 s the first time), then flows run serially on one worker.
- Browser: `E2E_CHROMIUM_PATH` selects a Chromium executable. Local default: `%LOCALAPPDATA%\ms-playwright\chromium-1248\chrome-win64\chrome.exe`. If that file does not exist, Playwright's own browser is used (`npx playwright install chromium`).
- Every test fails on `console.error`, uncaught page errors or HTTP >= 500 (only the expected 404s for "no profile yet" and "demographics not set" are ignored).
- `fixtures/resume.pdf` was generated once with PyMuPDF.
