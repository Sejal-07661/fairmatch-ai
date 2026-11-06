# M4 Task 2: Web image (nginx + SPA)

Files: frontend/Dockerfile, frontend/.dockerignore, frontend/deploy/nginx.conf, frontend/deploy/nginx.test.mjs, `test:deploy` script in frontend/package.json.

TDD: test written first; initial run failed (conf missing). After creating the files, `npm run test:deploy` passes.

Verified: `npm run test:deploy` pass, `npm run build` pass, `npm run lint` clean, `npm run typecheck` clean, `npm test` pass (see output counts below).

Design notes
- The conf is mounted as conf.d/default.conf (http context), so `server_tokens` and `client_max_body_size` sit at that level next to `server {}`.
- nginx drops inherited `add_header` when a location defines its own, so every header is repeated in each location (the test checks the server-level set).
- CSP smoke test: local node static server (random port, killed on exit) serving dist with the exact headers; Chromium from E2E_CHROMIUM_PATH or the local chromium-1248, else Playwright's bundled one. Skipped with a message if dist/ is missing.

Finding: under `script-src 'self'` (no unsafe-eval) Chromium reports one eval violation at load. It comes from a library feature probe, `try { Function("") }` (react-router Cloudflare check), caught, and the app renders normally. The test ignores only eval-related reports and prints a note; anything else (other directives, console errors, page errors) fails. Recharts inline styles are fine under `style-src 'unsafe-inline'`.

Not run: `docker build -t fairmatch-web frontend` (Docker daemon off). The Dockerfile and nginx syntax (`nginx -t`) were therefore not exercised; `/api/` upstream `api` only resolves inside compose.
