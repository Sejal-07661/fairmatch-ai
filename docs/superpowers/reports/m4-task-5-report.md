# M4 Task 5: Frontend hardening

- vite.config.ts: `resolveApiTarget()` validates `VITE_API_TARGET` (absolute http(s) URL, else throws `VITE_API_TARGET must be an absolute http(s) URL`); test file `vite.config.test.ts` (added to vitest include).
- App.tsx: Opportunities, OpportunityDetail, Runs, RunDetail via `React.lazy` under one `<Suspense>` with `<p role="status">Loading...</p>`. recharts moves into the RunDetail chunk.
- Tests: new `src/App.lazy.test.tsx`; existing App/Runs/RunDetail tests preload lazy modules and await the heading (two small async tweaks).
- Main chunk: 748.24 kB before, 334.18 kB after (RunDetail chunk 400.15 kB, loaded on demand).
- Results: npm test 35 files / 376 tests pass; typecheck, lint, build, test:deploy pass.
- npm audit: `npm audit fix` only adds optional lightningcss platform binaries; the 10 remaining moderate findings (eslint chain, dev-only) need `--force` (eslint major change), so left. Production audit: 0 vulnerabilities. package.json/lock untouched by me.
- e2e NOT run (per instruction); caller to run `npm run e2e`.
- No new env vars were added, so no PowerShell docs added.
