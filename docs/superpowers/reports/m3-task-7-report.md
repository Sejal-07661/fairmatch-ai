# M3 Task 7 report: end-to-end tests and docs

Status: done.

- Backend: `fairmatch/scripts/e2e_prepare.py` and `fairmatch/tests/test_e2e_prepare.py`.
- Frontend: `playwright.config.ts`, `e2e/{helpers,global-setup,global-teardown,flows.spec}.ts`, `e2e/README.md`, `e2e/fixtures/resume.pdf` (about 1 KB, PyMuPDF).
- `vite.config.ts` reads `VITE_API_TARGET` (default unchanged). `tsconfig.node.json` now includes `e2e` and the DOM lib.
- Docs: `frontend/README.md`, `fairmatch/README.md` (Dashboard section).
- e2e: 7 flows pass on a fresh DB, twice in a row (about 1.4 min each). Ports 5173 and 8765 are free afterwards and no temp dir is left.

Notes:
- Playwright starts webServers before global setup, so the temp dir is created in the config and `e2e_prepare.py` runs in the backend webServer command. Global setup warms the model and deletes the warm-up opportunity.
- Expected 404s ("no profile yet", "demographics not set") are allowlisted in the console guard.
