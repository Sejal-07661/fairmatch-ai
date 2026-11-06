# FairMatch AI dashboard

Vite + React + TypeScript SPA for the FairMatch API. Part of FairMatch AI: see the [root README](../README.md) for the Docker quick start and [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the production web image (nginx).

## Install and run

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api -> http://127.0.0.1:8000 (prefix stripped)
```

Run the backend from `fairmatch/` (see its README). The dev proxy target defaults to `http://127.0.0.1:8000`; if that port is taken by another program, start the API elsewhere and point the proxy at it:

```bash
# fairmatch/
python -m uvicorn api.main:create_app --factory --port 8765
# frontend/
VITE_API_TARGET=http://127.0.0.1:8765 npm run dev
```

PowerShell:

```powershell
$env:VITE_API_TARGET = "http://127.0.0.1:8765"; npm run dev
```

## Scripts

`dev`, `build`, `preview`, `test` (vitest), `lint`, `typecheck`, `gen:api`, `test:deploy` (checks `deploy/nginx.conf`), `e2e` (Playwright against the real backend, see `e2e/README.md`).

## API contract snapshot workflow

The backend contract is the committed `../fairmatch/openapi.json`; `src/api/schema.d.ts` is generated from it.

```bash
# after changing the API (from fairmatch/)
python scripts/export_openapi.py          # rewrite openapi.json
python scripts/export_openapi.py --check  # verify it is current (also a pytest)
# then (from frontend/)
npm run gen:api
```

## Roles

- Candidate: `/profile` only (upload a resume as text or a .pdf/.docx/.txt file, see extracted skills). Candidates never fetch or see demographics or fairness data.
- Admin: opportunities, candidates (with demographic group labels), runs, results, comparison, fairness and explanations.
- A candidate opening an admin URL sees a Forbidden page and no admin request is made. The server stays authoritative.

## Token storage

The access token is kept in `sessionStorage` only (cleared when the tab closes, never in `localStorage` or URLs). Role and expiry are read from the token for routing only. An expired token or a 401 clears the session and redirects to `/login?next=<path>`.

## Known limits

- A run that stays pending/running keeps being polled (with a waiting timer and a manual refresh). The server reclaims stuck runs only when a worker (re)starts, so the UI can still show the waiting note until then.
- Run status is polled every 1.5 s; there is no push channel.
- Lists are fetched in API pages of 100 and shown 25 rows per page; the e2e suite uses the Vite dev server, not the production build.
- Admin pages are lazy-loaded; the production build is served by nginx (`deploy/nginx.conf`, `Dockerfile`).
