# M3 final judge (Milestone 3: React dashboard)

Date: 2026-11-04. Scope: whole milestone, with focus on the uncommitted Task 7 (e2e flows, e2e_prepare.py, vite/playwright config, docs).
Judge was read-only on source; all experiments ran in scratch copies or throw-away temp dirs.

VERDICT: **PASS_WITH_FIXES**, 2 blocking issues (B1: e2e_prepare.py resets an existing admin's password to the published test credential; B2: stale lines in fairmatch/README.md). Details under "Final verdict" at the end.

## Progress log (appended after each check)

### Check 1: static suite (PASS)

- `npm test`: 33 files, 369 tests passed (47.7 s). The jsdom stack trace in the output is the ErrorBoundary test's intentional throw (guard replaced), as in prior judgements.
- `npm run typecheck`: exit 0 (now includes `e2e/` via tsconfig.node.json). `npm run lint`: exit 0. `npm run build`: exit 0 (single 748 kB JS chunk, >500 kB warning, non-blocking).
- Backend: `pytest tests/test_e2e_prepare.py tests/api/test_openapi_snapshot.py -q` 4 passed; `export_openapi.py --check` "up to date"; `ruff check .` all passed.
- `git diff HEAD --stat` on frontend/package.json, package-lock.json, fairmatch/core, fairmatch/api, fairmatch/openapi.json: empty (unchanged).
- Hygiene greps over frontend (excluding node_modules): no dangerouslySetInnerHTML (only the lint rule), no localStorage use in src (only a test asserting it stays empty, and README text), no @ts-ignore/@ts-expect-error, no `any` type, no .skip/.only/test.fixme/expect.soft in src or e2e, no eslint-disable. One `page.waitForTimeout(1000)` at frontend/e2e/flows.spec.ts:142 (used as a "URL stays stable, no redirect loop" probe; acceptable, see check 2).

### Check 3 (part 1): real e2e runs from frontend/

- Run 1 (21:46:40, cold): global setup failed with `TimeoutError: apiRequestContext.post: Timeout 170000ms exceeded` on the warm-up `POST /opportunities` (frontend/e2e/global-setup.ts:14), and npm exited 1 after 2356 s. Cause is environmental, not the code: the Windows System log shows the laptop entered Modern Standby at 21:46:55 (15 s into the run, "Austerity Battery Drain Budget Exceeded") and resumed at 22:25:52. Even on this failure path the temp dir was removed and ports 5173/8765 were free afterwards (only TIME_WAIT), and PID 7932 still owned 8000.
- Run 2 (22:25:56): `7 passed (1.5m)`, exit 0 after 122 s. Model weights loaded in under 1 s (OS cache). Afterwards: no `%TEMP%\fairmatch-e2e-*` dir left, 5173/8765 not listening, 8000 still LISTENING by PID 7932.
- Warm-up failure message is explicit (status, timeout and call log), good. Side note: the call log printed by Playwright on the warm-up timeout includes the admin JWT (signed with the throw-away `e2e-secret`, for the throw-away DB). Harmless here, see check 3 notes.

### Check 4: vite.config.ts VITE_API_TARGET (PASS, notes)

Probe: a node script (scratch) called Vite's `createServer` on the real `vite.config.ts` (cacheDir in scratch, port 5199) with an echo backend on 8766, then requested `/api/health`. Requests to 8000 were never sent.

| VITE_API_TARGET | resolved target | GET /api/health |
|---|---|---|
| unset | http://127.0.0.1:8000 | not sent (8000 belongs to Manager.exe) |
| "" | http://127.0.0.1:8000 (`||` fallback) | not sent |
| `127.0.0.1:8766` (no scheme) | `127.0.0.1:8766` | 502 |
| `http://127.0.0.1:8766` | same | 200, upstream path `/health` |
| `http://127.0.0.1:8766/` | same | 200, upstream path `/health` (no double slash) |
| `http://127.0.0.1:8766/v1` | same | 200, upstream path `/v1/health` (prefix kept) |
| `not a url` | `not a url` | 502 |

- Default unchanged vs HEAD (HEAD line 11 hard-coded `http://127.0.0.1:8000`; now `process.env.VITE_API_TARGET || "http://127.0.0.1:8000"`).
- Invalid values are not validated at startup: they surface only as 502 per request (non-blocking; suggest `new URL()` with an http/https check that throws at config load).
- The variable has the `VITE_` prefix, which is Vite's convention for client-exposed env. It is not referenced from client code, so nothing is embedded (see below), but a non-prefixed name such as `API_PROXY_TARGET` would remove the risk of a future `import.meta.env` dump exposing it (non-blocking).
- Build with and without `VITE_API_TARGET=http://127.0.0.1:8765` produced byte-identical bundle names (`index-Dp_9yGUb.js`); grep of both dists for `e2e-secret`, `Passw0rd`, `127.0.0.1:8765`, `8765`, `VITE_API_TARGET`, `127.0.0.1:8000`, `sourceMappingURL`: no matches. No `.map` files.

### Check 3 (part 2): e2e safety analysis (by reading plus a scratch experiment)

- `reuseExistingServer: false` on both webServers, backend fixed to 8765 and Vite to 5173 with `--strictPort`; nothing in the config or flows refers to 8000. (A live "port already taken" experiment is recorded in part 3.)
- The config always overrides `DATABASE_URL` for the backend with the temp path (`sqlite:///<E2E_TMP_DIR>/e2e.db`), and `E2E_DB_PATH` is always derived from it, so an external `DATABASE_URL` cannot redirect the run. However:
  - **e2e_prepare.py has no "fresh / throw-away DB" guard.** Scratch experiment: ran it on a fresh scratch DB, changed `admin@example.com`'s hash to `REAL-PRODUCTION-HASH`, ran it again: exit 0, no output, and the hash was replaced with a bcrypt hash of the published `E2e-Passw0rd!` (via `create_admin`, which "promotes an existing user and resets their password", fairmatch/api/cli.py:22-24). So `python scripts/e2e_prepare.py <any existing db>` silently installs a documented admin credential. The docstring (e2e_prepare.py:1 "Prepare a fresh SQLite database") and the plan ("on a fresh SQLite file") promise a fresh file. See blocking issue B1.
  - **`E2E_TMP_DIR` is honoured if already set** (playwright.config.ts:24) and global teardown runs `rmSync(dir, { recursive: true, force: true })` on it with no check (frontend/e2e/global-teardown.ts:7-9). It is an internal handshake variable (workers inherit it) and is not documented, but anyone who sets it, for example to keep artefacts, gets that directory deleted recursively. A live canary experiment is recorded in part 3.
- Model warm-up hack (global-setup.ts): it creates one opportunity through the API, then runs `delete from opportunities` with sqlite3 on `E2E_DB_PATH`. I judge it safe: the embedding is stored inline in the `opportunities` row (fairmatch/api/models.py:55), nothing else references it (no runs exist yet), the Redis embedding cache is keyed by text hash, not id (api/services/embedding.py:39-40), and the API is idle when the delete runs (the warm-up response has returned; CELERY_EAGER runs everything inline). SQLite reuses id 1 for the next opportunity, which is harmless because nothing points at the deleted row. A lock would surface as an `execFileSync` exception (explicit failure), not silent corruption. Non-blocking: the delete bypasses the API layer; deleting only `where title='warmup'` would be more targeted.
- Login failure in global setup is not checked before reading `access_token`; it would still fail explicitly with `warmup failed: 401 ...`. Fine.
- Secrets in logs: Playwright's call log for a failed warm-up request prints the admin `Authorization: Bearer` JWT (seen in run 1). The token is signed with `e2e-secret`, belongs to the throw-away DB, and expires, so this is harmless. The admin and candidate passwords appear only in helpers.ts/e2e_prepare.py as documented test credentials and are not printed by the passing runs.

### Check 9: hygiene (PASS)

- `git status --short`: only the expected Task 7 files (M fairmatch/README.md, frontend/README.md, playwright.config.ts, tsconfig.node.json, vite.config.ts; ?? m3-task-7-report.md, e2e_prepare.py, test_e2e_prepare.py, frontend/e2e/) plus this report.
- `git status --ignored`: only caches (`__pycache__`, `.pytest_cache`, `.ruff_cache`) and `frontend/dist/`. No stray .db/.log/.png/.webm/.trace in the repo (find, excluding node_modules/.git).
- `.gitignore` covers `frontend/test-results/`, `frontend/playwright-report/`, `frontend/dist/`, `*.db`. Playwright `outputDir` and the DB live in `%TEMP%\fairmatch-e2e-*`, so no repo artefacts are produced.

### Check 6: spec coverage for the dashboard

The spec (2026-11-02-fairmatch-design.md section 10 item 3) scopes Milestone 3 as "Dashboard (upload, run, algorithm comparison, fairness view, explanations)"; sections 2-4 and 6-9 add JWT roles, protected attributes used only by the audit, failure states, and a "frontend smoke test".

| Requirement | Implementation | Unit tests | e2e |
|---|---|---|---|
| JWT login, register, session expiry | pages/Login.tsx, Register.tsx, auth/AuthContext.tsx, auth/token.ts (sessionStorage) | Login, Register, AuthContext, token, client tests | flows 1, 2, 5 |
| Roles candidate/admin, forbidden page | auth/RequireRole.tsx, App.tsx routes | RequireRole, App, Admin, RunDetail tests | flow 4 |
| Upload resume (text or .pdf/.docx/.txt) and see extracted profile | pages/Profile.tsx, components/ResumeForm.tsx, lib/validation.ts | Profile, ResumeForm, validation tests | flow 1 (text and a real PDF) |
| Upload postings (typed; the API has no posting file upload) | pages/Opportunities.tsx, components/OpportunityForm.tsx, OpportunityDetail.tsx | OpportunityForm, Admin tests | flow 2 |
| Protected attributes stored separately, used only by the audit | components/DemographicsEditor.tsx (admin-only, explains usage) | DemographicsEditor, Admin tests | flow 2 (set), flow 3 (missing) |
| Run allocation (hungarian, gale_shapley, both -> 202), status, failure message | components/StartRunForm.tsx, pages/Runs.tsx, components/RunStatus.tsx, hooks.useRun polling | StartRunForm, Runs, RunStatus, RunDetail, hooks tests | flows 2, 3, 7 |
| See matching results within capacity, unallocated list | components/AllocationTable.tsx | AllocationTable, RunDetail tests | flow 2 (seats <= capacity) |
| Compare Hungarian vs Gale-Shapley (total score, blocking pairs, runtime) | charts/ComparisonCharts.tsx | ComparisonCharts tests | flow 2 (legend only) |
| Fairness view (selection rates, disparate impact, four-fifths, parity) | charts/FairnessCharts.tsx, StatusBadge.tsx | FairnessCharts, StatusBadge tests | flows 2, 3 |
| Explanations (reasons, narrative, breakdown) | components/ExplanationPanel.tsx, charts/BreakdownBar.tsx | ExplanationPanel, BreakdownBar tests | flow 2 (breakdown segment) |
| Similar candidates (pgvector search) | components/SimilarCandidates.tsx | SimilarCandidates tests | none |
| "Frontend smoke test" (section 9) | Vitest suite, 369 tests, plus 7 Playwright flows against the real API | | |

Audit trail: the repo has no proposal document (grep for "audit trail" / "View Matches" finds nothing), and the spec does not use the phrase. There is no dedicated audit-trail view. What exists is a run history (`/runs`: id, algorithm, status, created, finished) plus, per run, the stored allocations, the fairness audit and per-match explanations. Who requested a run and the scoring weights are not shown: the API's `RunOut`/`RunSummaryOut` do not expose `requested_by` or params, so this would need an API change. Non-blocking for this milestone, because the spec's Milestone 3 list does not include it. If the proposal text "View Matches & Audit Trail" is binding for the viva, a small "Run history" heading and requested-by column are the natural follow-up (Milestone 4).

### Check 7 (part 1): built-app privacy and security sweep

- `npm run build` (check 1) then grep of `dist/` for `e2e-secret`, `Passw0rd`, `Cand-Passw0rd`, `admin@example`, `JWT_SECRET`, `OPENAI`, `localStorage`, `console.log`, `__charts`/`ChartsPreview`/`charts-preview`, `127.0.0.1:8000`, `8765`: 0 hits. The only `sk-` hits are inside `task-` strings (false positive). `fairmatch.token` appears once (the sessionStorage key, expected).
- Source maps: none emitted (`dist/assets` holds one .js and one .css; no `sourceMappingURL`). Good.
- The dev-only chart preview (`charts-preview.html`, `src/charts-preview.tsx`) is not in the production build.
- `dist/index.html` has charset, viewport, `lang="en"`, a `data:,` favicon and a title, but no Content-Security-Policy or referrer policy. Non-blocking advice: set CSP (`default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'`), `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` at the serving proxy in Milestone 4. A meta CSP works too, but the headers approach is better.
- `npm audit --omit=dev`: **0 vulnerabilities** in production dependencies. Full `npm audit`: 13 moderate, all dev-only (minimatch ReDoS reached through eslint, typescript-eslint and openapi-typescript). Non-blocking.

### Check 2 (part 1): e2e assertion quality, by reading flows.spec.ts and helpers.ts

Overall the flows assert real outcomes, not just headings. No `.catch(() => {})`, no try/catch, no `expect.soft`, no optional steps, no `test.skip/only/fixme`. One fixed sleep: `page.waitForTimeout(1000)` at flows.spec.ts:142, used as a "URL stays put, no redirect loop" probe. It is acceptable as a negative-stability check.

Console guard (helpers.ts:10-35): fails on any `console.error`, `pageerror` or HTTP >= 500 response. The 404 allowlist is narrow: it requires the message to contain "status of 404" **and** the console location pathname to match `^/api/(candidates/me|candidates/\d+/demographics)$` exactly (helpers.ts:11-13). Any other 404, every 401/403/422 (Chromium logs "Failed to load resource" as console.error) and every 5xx still fail the test. Mutants a and b1 below confirm this: unexpected 403s were caught.

Per flow:
- Flow 1: name heading, at least one skill chip, and a "python" chip for the text upload. The PDF upload only asserts at least one chip, not which skills (weak but sufficient: no file means no profile).
- Flow 2: seats `used <= capacity` for every `N / M` cell, both legend entries, a ratio-consistent badge, and a breakdown segment in the opened explanation. Weak spots:
  - (i) `allTextContents()` at flows.spec.ts:76 is a non-retrying snapshot taken as soon as the Results tab appears. Capacities come from a separate `useAllOpportunities` fetch and render as `N / ?` until it lands, and `?` rows are silently dropped by the regex. So the check can see 0 or only some rows. It has not flaked in 12 runs, but `await expect(cells.first()).toBeVisible()` or `expect.poll` would make it deterministic.
  - (ii) Only the default (Hungarian) results view is checked. The Gale-Shapley radio is never selected.
  - (iii) The badge check is relative to whatever ratio the run produced (1.000 with this seed), so a wrong threshold cannot be detected (mutant d survives).
  - (iv) Comparison checks only the legend, not the values.
  - (v) Explanation checks the breakdown, not the reasons/narrative text.
- Flow 3: exact server reason `demographics missing for 1 of 3 candidates`. Strong, but it depends on flow 2 having set two labels.
- Flow 4: Forbidden heading plus zero `/api/runs` requests. Strong.
- Flow 5: both the malformed and the expired token land on `/login?next=%2Fruns%2F3` and stay there. Note: these pages come from `browser.newContext()`, so the auto `guard` fixture (bound to the default `page`) does **not** watch them. A console error or 5xx in flow 5 would go unnoticed. The URL is hard-coded to `http://127.0.0.1:5173` (flows.spec.ts:139) instead of `baseURL`.
- Flow 6: hostile name rendered as heading text, `window.__xss` undefined for both the candidate and the admin list. Strong.
- Flow 7: exactly 25 rows, newest first, no "Invalid Date" on either page, page 2 older than page 1. Strong.
- Order/state dependence: the file is `mode: "serial"` with shared DB state. Flows 2-7 need flow 1's users, and flow 3 needs flow 2's labels. When an early flow fails, later ones are reported "did not run" (clear signal). Running one flow alone with `-g` does not work. Acceptable for a journey suite, but worth a sentence in e2e/README.md.

### Check 2 (part 2): mutation testing of the e2e suite against the real app

Setup: a scratch copy of `fairmatch/` and `frontend/` (node_modules junctioned), with each mutant applied to the scratch `src/` only. For each mutant the full Vitest suite and the full `npx playwright test` ran against the real backend (fresh temp DB per run, ports 5173/8765, the config has no port knobs). Mutants ran sequentially, each restored from the real `src/` before the next. Script: `C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\mut\mutants.py`.

| # | Mutant (product bug) | e2e | unit suite | Notes |
|---|---|---|---|---|
| a | RequireRole lets candidates into admin routes | **KILLED** (flow 4: no Forbidden heading; the guard also saw 403s) | killed (5 tests) | |
| b1 | Candidate Profile fetches `/candidates/{id}/demographics` and shows the group label | **KILLED** (flow 1 guard: two 403 console errors) | **survives** | caught only because the server answers 403 |
| b2 | Explanations tab fetches and shows the candidate's group label | **SURVIVES** | **SURVIVES** | finding N1 |
| c | Seats used counted across both algorithms | **KILLED** (flow 2: "Expected <= 2, Received 4") | killed (2 tests) | |
| d | Fairness badge passes ratios >= 0.5 (`passesRule(data) \|\| ratio >= 0.5`) | survives (seeded run has ratio >= 0.8) | killed (3 tests) | fine |
| e | Naive timestamps rejected and rendered "Invalid Date" | **KILLED** (flow 7) | killed (6 tests) | |
| f1 | apiFetch appends `t=<token>` to every URL | survives | killed (1 test, `test_sends_limit_and_offset`, incidental exact-URL check) | fine, but no test targets the leak itself |
| f2 | apiFetch `console.log("auth", token)` | survives | killed (`test_token_never_logged`) | fine |
| g | saveToken also writes localStorage | survives | killed (`test_never_uses_local_storage`) | fine |
| h | useRun polls forever, even after done | survives | killed (5 polling tests) | fine |

Result: the e2e suite kills 4 of 10 (a, c, e directly, b1 through the console guard). The unit suite kills 8 of 10. Only **b2 survives both**.

Root cause for b1/b2 surviving the unit suite (verified with a throw-away probe test in the scratch copy): `src/test/setup.ts` sets `onUnhandledRequest: "error"` and makes `console.error` throw. MSW's unhandled-request handler calls `console.error`, the throw happens *inside* MSW, and MSW turns it into a **500 response** to the app. The probe printed `resolved 500 {"name":"Error","message":"console.error called during test: ...` and the test **passed**. So an unexpected request in any unit test is silently answered with a 500 instead of failing the test. This weakens the Global Constraint "Tests fail on any console.error" (setup.ts:6,9-15). See non-blocking N2.

### Check 3 (part 3): live robustness probes (scratch copy, pristine src)

- **Port 8765 already taken** (a dummy `python -m http.server 8765` serving `/health`): Playwright stopped at once with `Error: http://127.0.0.1:8765/health is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.` and exit 1. It did not attach to the other server and did not create a temp dir. The dummy was then killed by its own PID (30296, the 127.0.0.1:8765 listener only). PASS.
- Environment note: the machine entered Modern Standby repeatedly (22:53-00:19) and **rebooted at 01:18:44** (`LastBootUpTime`). That reboot restarted Manager.exe, so port 8000 is now owned by **Manager.exe PID 7668** instead of 7932 (`tasklist`: 7932 no longer exists; 7668 is Manager.exe in the Services session). The judge never sent anything to 8000 and never signalled any process except its own listeners on 8765. The first missing-browser / external `E2E_TMP_DIR` probe started at 22:53:26, one second before standby, and ended with `Timed out waiting 180000ms from config.webServer`, so it was inconclusive. It was rerun below.

- **Missing browser** (rerun 01:23, `E2E_CHROMIUM_PATH=C:\nope\chrome.exe` plus an empty `PLAYWRIGHT_BROWSERS_PATH`): the bad path is silently ignored (playwright.config.ts:20-22) and Playwright falls back to its own default, which for headless is `chromium_headless_shell-1248`. That build is **not installed on this machine** (only `chromium-1248` is), so the run fails with Playwright's explicit `browserType.launch: Executable doesn't exist at ...chrome-headless-shell.exe` box suggesting `npx playwright install`. Explicit enough, but a mistyped `E2E_CHROMIUM_PATH` leads to an unrelated-looking install hint. Non-blocking: throw `E2E_CHROMIUM_PATH does not exist: <path>` when the variable is set and the file is missing, and keep the silent fallback only for the built-in default. Side note: `LOCAL_DEFAULT_CHROMIUM` hard-codes revision 1248, so after a Playwright upgrade the suite keeps launching the old build silently.
- **External `E2E_TMP_DIR`** (same rerun, set to a scratch dir holding `precious.txt`): the run used it for `e2e.db` and `results/`. Global teardown then attempted `rmSync(dir, {recursive: true})` (global-teardown.ts:7), but it was aborted by the Windows lock on `e2e.db` (still held by uvicorn), so `precious.txt`, `e2e.db` and `results/` survived. The config registers the second, on-exit removal only when it created the dir itself. Contents survived by luck of lock ordering: with an earlier-sorting file name, or on a platform without the lock, a user-supplied dir would be deleted recursively. Non-blocking (the variable is undocumented and internal), but see N3 for the guard.
- Fresh-DB behaviour confirmed in every run: flow 7 sees run ids 3..28, so no state leaked between runs. 12 runs (2 real, 10 mutant) left no `%TEMP%\fairmatch-e2e-*` dir behind.

### Check 7 (part 2): token handling end to end in real Chromium (PASS)

A judge backend ran on 8765 (own scratch DB prepared with e2e_prepare.py, JWT_SECRET=judge-secret, CELERY_EAGER, fakeredis, HF offline, no OpenAI key), with the docs-literal `VITE_API_TARGET=http://127.0.0.1:8765 npm run dev` on 5173 from the pristine scratch copy, driven by the repo's Playwright with `chromium-1248\chrome-win64\chrome.exe`. Seed: 5 candidates (one named `<img src=x onerror="window.__xss=1">`, one with an 80-character name), 3 opportunities (one with a 100-character title), one `both` run. Script: `C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\shots\seed_and_shoot.mjs`.

- After login (candidate and admin, at 1280 and 360): sessionStorage keys `["fairmatch.token"]`, localStorage keys `[]`, cookies 0, token not in the URL, token not in any console message, `window.__xss` undefined. The hostile name renders as text in Candidates, Results and Explanations.
- After Sign out: sessionStorage `[]`, localStorage `[]`, cookies 0. Browser Back after an admin sign-out lands on `/login?next=%2Fruns` (no cached admin page shown).
- No console errors or warnings in any of the 4 sessions.
- UX note (non-blocking): an explicit Sign out lands on `/login?next=<current page>` (for example `next=%2Fruns%2F1`), so the next person to sign in on that tab is sent to the previous user's page (a candidate would land on Forbidden). Plain `/login` is the usual choice for a deliberate logout.

### Check 8: screenshot review (light theme, 1280 and 360)

All 20 screenshots are in `C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\shots\png`: login, profile (candidate), opportunities, candidates, candidate-detail, runs, run-results, run-comparison, run-fairness, run-explanations, each as `-1280.png` and `-360.png`. No page-level horizontal overflow at either width (scrollWidth equals clientWidth on every page). No collisions in the charts, contrast reads well, long names and titles are truncated with ellipsis, and the hostile name shows as literal text. The fairness view correctly shows a real failing case (0.500, "Fails four-fifths rule" with icon) for this seed.

Findings (all non-blocking):
1. 360: data tables scroll inside their container with no visual affordance, and key columns start off-screen.
   - run-results-360.png: Candidate and Score columns are hidden and the "Seats used / capacity" header is cut at "capacit".
   - candidates-360.png: only Name and Skills are visible; Experience, Education, Mode and the **View** link are off-screen.
   - opportunities-360.png: header cut at "Capacit"; the View link is off-screen.
   - runs-360.png: "Finished" header and dates clipped at the right edge; "Run 1" link wraps onto two lines.
   
   Suggest a stacked/card layout below the `sm` breakpoint, or a scroll-shadow hint plus putting the key column (candidate / View) first.
2. run-explanations-360.png: after pressing Explain, the table is scrolled so that Algorithm and Candidate are off-screen, and the Explanation panel itself (both widths, run-explanations-1280.png) **does not say which candidate/opportunity/algorithm it explains**. There is no visible pressed state on the selected Explain button (only `aria-pressed`), and the panel appears below all rows without scrolling into view. Suggest a panel heading such as "Alice Candidate -> Data Engineer (Hungarian)", a pressed style, and `scrollIntoView` on select.
3. run-fairness-360.png: the "100.0%" value labels are clipped at the plot's right edge.
4. run-comparison-1280.png: in the middle card ("Blocking pairs") the Chart/Table toggle wraps under the subtitle, so its plot sits about 40 px lower than its neighbours and the three small multiples are not aligned.
5. run-results-1280.png and -360.png: the Unallocated list uses `list-disc`, but `truncate` (overflow hidden) on each `li` clips the bullet marker, so the item looks like stray indented text.
6. candidates-1280.png and candidate-detail-*.png: "1 yrs" / "1 years" (singular not handled). Cosmetic.
7. login-*.png: the login page has no app name or header (only "Sign in"). Cosmetic.

### Check 5: docs accuracy

Executed literally:
- `VITE_API_TARGET=http://127.0.0.1:8765 npm run dev` (frontend/README.md:18): Vite printed `Local: http://localhost:5173/`, and `curl http://localhost:5173/api/health` returned `{"status":"ok"}` from the 8765 API. Matches the README.
- `npm run e2e` (check 3), `npm test`, `typecheck`, `lint`, `build` (check 1): as documented.
- `python scripts/export_openapi.py` (in a scratch copy): byte-identical to the committed `openapi.json`. `--check` passes.
- `npm run gen:api` (in a scratch copy): byte-identical to `src/api/schema.d.ts`.
- `npm install` was not run against the real tree (it could rewrite node_modules/lockfile). The lockfile is unchanged vs HEAD and `npm audit` resolves it cleanly.

Statements checked against code:
- Routes and roles: App.tsx:32-44 matches the README (candidate `/profile`; admin `/runs`, `/opportunities`, `/candidates` and their detail pages; `/forbidden`; NotFound).
- Upload types and limits: validation.ts:1-30 matches ".pdf/.docx/.txt", 20000 characters, 5 MiB.
- Token storage: token.ts:45-75 uses sessionStorage only (verified in a browser in check 7).
- Polling 1.5 s: hooks.ts:26. Paging 25: Runs/Opportunities/Candidates `PAGE = 25`. Stuck note after 60 s: RunStatus.tsx:16.
- e2e/README.md: ports, env, strictPort, temp DB, warm-up, serial single worker, guard allowlist and fixture provenance all match the config and helpers. The fixture PDF is synthetic ("Priya Nair - Data Engineer", empty metadata).

Inaccuracies and stale text (should fix, small):
- **fairmatch/README.md:20** still lists `| Frontend Dashboard (React) | Planned next |`. The row is also missing its third (File) cell. Should read `| Frontend dashboard (React) | Done | ../frontend/ |`.
- **fairmatch/README.md:146-148** "Next steps: Build a simple React dashboard so this can be used without editing code" is stale now that the Dashboard section exists (it should become, for example, "Docker Compose, CI and docs (Milestone 4)").
- **fairmatch/README.md:144** "lists are paged client-side" is inaccurate: the Runs/Opportunities/Candidates lists are paged server-side (`limit`/`offset`, 25). Only the results and explanation tables are paged client-side. The frontend README wording ("Lists are paged 25 at a time") is correct.
- frontend/README.md "Known limits" omits the accepted stuck-run limitation (runs killed mid-way stay `running`; the UI shows a stuck note after 60 s). Also, the env-var example is POSIX-only. A PowerShell line (`$env:VITE_API_TARGET="http://127.0.0.1:8765"; npm run dev`) would help on this Windows project. Non-blocking.
- e2e/README.md does not say that the flows share state and cannot run individually with `-g`. Non-blocking.

No scaffold leftovers (Vite template text, placeholder headings) remain in either README.

---

## Final verdict

**VERDICT: PASS_WITH_FIXES** with 2 blocking issues, both small. The static suite is green and the e2e suite is green and repeatable (7/7 on a fresh DB; the one failure was a laptop standby). Clean-up is reliable, the e2e assertions are mostly real, the token handling and XSS safety hold in a real browser, the production deps are clean, and the dist leaks nothing.

### Blocking issues

**B1. `fairmatch/scripts/e2e_prepare.py:17-32` installs the published test admin credential into any existing database.**
- Problem: `prepare()` accepts any path and calls `create_admin`, which promotes or resets an existing `admin@example.com` (fairmatch/api/cli.py:22-24). Verified in scratch: the second run on an existing DB replaced a real admin hash with a bcrypt of `E2e-Passw0rd!`, with exit 0 and no output. That contradicts the script's own "fresh database" docstring (line 1) and the plan's "fresh SQLite file" contract.
- Fix: at the top of `prepare`, refuse a pre-existing file, for example `if Path(db_path).exists(): raise SystemExit(f"refusing: {db_path} already exists; e2e_prepare only creates fresh databases")`, or return 2 from `main` with that message on stderr. Optionally also require that the resolved path is under `tempfile.gettempdir()`.
- Test: add one to `fairmatch/tests/test_e2e_prepare.py`, for example `test_prepare_refuses_existing_db`: run once, run again, assert a non-zero exit and an unchanged admin hash.
- The Playwright config is unaffected (its DB is always a fresh `mkdtemp` file).

**B2. Stale and inaccurate statements in `fairmatch/README.md` contradict the new Dashboard section.**
- Line 20: `| Frontend Dashboard (React) | Planned next |`. Make it `| Frontend dashboard (React) | Done | ../frontend/ |`.
- Lines 146-148: "Next steps: Build a simple React dashboard so this can be used without editing code". Replace with the real next step (Docker Compose, CI and docs, Milestone 4).
- Line 144: "lists are paged client-side". Change to "lists are paged 25 at a time from the API; result tables paginate client-side".

### Non-blocking notes (recommended, in priority order)

- **N1 (test gap, privacy).** Mutant b2 (the Explanations tab fetches and shows the candidate's group label) survives **both** the unit and the e2e suites. fairmatch/README.md's privacy rule says group labels are "never part of scoring, explanations or candidate-facing responses". Fix: in `ExplanationPanel.test.tsx`/`RunDetail.test.tsx`, assert that no `/demographics` request is made and that no label text appears. In flow 2, assert `expect(region).not.toContainText("Group A")` and that no `/api/candidates/*/demographics` request happens on `/runs/:id`.
- **N2 (unit-test harness).** `frontend/src/test/setup.ts:6,9-15`: MSW `onUnhandledRequest: "error"` plus a throwing `console.error` does **not** fail a test. MSW swallows the throw and answers the app with a 500 (verified with a probe test that passed). This is why b1 and b2 pass the unit suite. Fix: collect unhandled requests and `console.error`/`console.warn` calls into arrays and `expect(...).toEqual([])` in `afterEach`. Alternatively, `onUnhandledRequest(req) { unhandled.push(req.url) }` and assert in `afterEach`.
- **N3 (destructive footgun).** `frontend/playwright.config.ts:24` honours a pre-set `E2E_TMP_DIR`, and `frontend/e2e/global-teardown.ts:7` recursively deletes it unconditionally. Fix: only remove a dir that the config created. For example, check that `path.dirname(dir) === os.tmpdir()` and that the basename starts with `fairmatch-e2e-`, or set a private marker variable together with the dir. Also rename the variable to something clearly internal.
- **N4.** `E2E_CHROMIUM_PATH` pointing to a missing file is silently ignored (playwright.config.ts:20-22). Throw a clear error when the variable is set and missing. The hard-coded `chromium-1248` default will go stale after a Playwright upgrade.
- **N5 (e2e robustness and strength).**
  - The seats check uses a non-retrying `allTextContents()` snapshot (flows.spec.ts:76). Wait for the cells first, or use `expect.poll`.
  - Only the Hungarian results view is checked.
  - The badge check cannot detect a wrong threshold. Mutant d survives e2e; the unit suite kills it.
  - Flow 5's own `browser.newContext()` pages are not covered by the console guard, and it hard-codes `http://127.0.0.1:5173` (flows.spec.ts:139).
  - Document in e2e/README.md that the flows share state and must run as a whole.
- **N6.** `frontend/vite.config.ts:7`: invalid `VITE_API_TARGET` values (no scheme, garbage) only show up as per-request 502s. Validate with `new URL()` at config load. Consider a non-`VITE_` name, since the variable is server-side only.
- **N7 (UX, from screenshots, see check 8).**
  - At 360 px the data tables hide their key columns (Candidate/Score, View links) behind an unmarked horizontal scroll.
  - The Explanation panel does not name the candidate, opportunity or algorithm it explains, and the selected row has no visible pressed state.
  - Clipped "100.0%" labels at 360; a misaligned Blocking-pairs card at 1280; Unallocated bullets clipped by `truncate`; "1 yrs".
- **N8.** An explicit Sign out lands on `/login?next=<previous page>`, so the next user on that tab is redirected to the previous user's page. Use plain `/login` for deliberate logouts.
- **N9 (hardening for Milestone 4).** No CSP or referrer policy (set them at the serving proxy). A single 748 kB JS chunk (route-level `lazy()` would help). 13 moderate dev-only npm audit findings (minimatch through eslint and openapi-typescript); production has 0.
- **N10 (docs).** frontend/README "Known limits" omits the stuck-run note (accepted limitation), and the env example is POSIX-only (add the PowerShell form).
- **N11.** No dedicated audit-trail view (see the spec statement below).

### Spec-coverage statement

Every Milestone 3 item in the spec ("upload, run, algorithm comparison, fairness view, explanations") is implemented and tested at both unit and e2e level, along with the JWT login and candidate/admin roles from section 3:
- Candidates upload a resume as text or a .pdf/.docx/.txt file and see their extracted profile.
- Admins create postings, set demographic labels (stored separately and explained as audit-only), and start Hungarian, Gale-Shapley or both runs with polling and failure states.
- Admins see the allocations within capacity, the unallocated list, the side-by-side comparison of total score, blocking pairs and runtime, the four-fifths fairness audit with the exact skip reason, and the per-match explanations with an exact score breakdown.

The spec's section 8 failure modes (422 reasons, fallback flagged, failed-run message, up-front validation) are surfaced in the UI. Section 9's "frontend smoke test" is exceeded: 369 unit tests plus 7 real-backend Playwright flows. The phrase "audit trail" does not appear in the spec or anywhere in the repo, and no proposal document is present. There is no dedicated audit-trail view: the run history plus each run's stored allocations, fairness audit and explanations act as the decision record, but who started a run and with which parameters is not shown, because the API does not expose `requested_by`. This is non-blocking for this milestone. It is a natural Milestone 4 addition if the proposal's "View Matches & Audit Trail" wording is binding.

### Screenshots

All in `C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\shots\png\`:
`login-1280.png`, `login-360.png`, `profile-1280.png`, `profile-360.png`, `opportunities-1280.png`, `opportunities-360.png`, `candidates-1280.png`, `candidates-360.png`, `candidate-detail-1280.png`, `candidate-detail-360.png`, `runs-1280.png`, `runs-360.png`, `run-results-1280.png`, `run-results-360.png`, `run-comparison-1280.png`, `run-comparison-360.png`, `run-fairness-1280.png`, `run-fairness-360.png`, `run-explanations-1280.png`, `run-explanations-360.png`.

### Clean-up

- Every server the judge started is gone. The judge's uvicorn (PID 17708) and Vite (PID 23040) were killed by their listener PIDs, and the dummy http.server (PID 30296) likewise.
- Ports 5173, 5199, 8765 and 8766 are not listening. Port 8000 is still listening and owned by Manager.exe, now **PID 7668** because the machine rebooted at 01:18:44. The judge never touched it.
- No `%TEMP%\fairmatch-e2e-*` dirs remain. The scratch `node_modules` junctions were removed with `rmdir`; the real `node_modules` is intact.
- The repo working tree is exactly as at the start plus this report. No code, tests or docs were edited, and nothing was committed.

