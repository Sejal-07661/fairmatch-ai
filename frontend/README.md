# FairMatch AI dashboard

Vite + React + TypeScript SPA for the FairMatch API.

## Install and run

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api -> http://127.0.0.1:8000 (prefix stripped)
```

Scripts: `dev`, `build`, `preview`, `test` (vitest), `lint`, `typecheck`, `gen:api`, `e2e` (Playwright; run `npx playwright install` first).

## API contract snapshot workflow

The backend contract is the committed `../fairmatch/openapi.json`; `src/api/schema.d.ts` is generated from it.

```bash
# after changing the API (from fairmatch/)
python scripts/export_openapi.py          # rewrite openapi.json
python scripts/export_openapi.py --check  # verify it is current (also a pytest)
# then (from frontend/)
npm run gen:api
```
