# M4 Task 7: Documentation

Written: `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/FAIRNESS.md`. Updated: `fairmatch/README.md` (links up; PostgreSQL line, upload note, reclaim note and env vars, next steps; Celery/alembic commands via `python -m`), `frontend/README.md` (links up; stuck-run "no server-side timeout" and "25 per page" statements corrected; `test:deploy` listed). No code edited.

Commands run literally and passing: backend `pytest -m "not slow and not llm and not db"` (311 passed), `ruff check .`, `export_openapi.py --check`; frontend `npm ci`, `test`, `typecheck`, `lint`, `build` (main chunk 334 kB), `test:deploy`; `npm run e2e` 7/7 (with `E2E_CHROMIUM_PATH`); `python demo.py`; local SQLite flow (`alembic upgrade head`, `create-admin`, uvicorn on 8765, login returned a token). Port 8000 untouched; the temporary `fairmatch.db` was deleted.

Fixed in docs after running: bare `alembic` and `celery` are not on PATH here, so docs use `python -m alembic` and `python -m celery`.

Not run: any Docker command (daemon off; docs say "verified by static tests and CI build only"), `pytest -m db`, the backup/restore commands, `npm run dev` interactively.

Spot-checked against source (all matched): 503 on enqueue failure also marks the run failed (`routers/runs.py`); score weights 0.4/0.4/0.1/0.1 and 0.5 credit for related skills (`core/scoring.py`); register always creates `candidate` (`routers/auth.py`); `MAX_CAPACITY = 10_000` and `MAX_CELLS = 25_000_000`; reclaim semantics and defaults 30/5 (`services/runs.py`, `config.py`); `OPENAI_MODEL` default; fairness ratio and four-fifths (`core/fairness.py`); nginx directives and compose wiring; lists fetched in pages of 100, shown 25 per page, poll 1.5 s (`hooks.ts`).

Relative links in all six docs resolve (script check). Known limitations listed in README and DEPLOYMENT: no audit-trail view, PostgreSQL verified offline/CI only, Docker unverified, education regex edge cases, upload spooled before the 5 MiB check without nginx, reclaim only at worker start.

Notes for the committer: the root README CI badge points at the real repo URL; the first-run `JWT_SECRET` generator is `python -c "import secrets; ..."` (works in both shells). The backup `psql` restore and PowerShell redirection forms are untested.
