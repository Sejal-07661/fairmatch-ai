# FairMatch AI Milestone 3: Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React + TypeScript dashboard where candidates upload a resume and view their profile, and admins manage opportunities, set demographics, start allocation runs, compare Hungarian vs Gale-Shapley, audit fairness and read per-match explanations.

**Architecture:** A Vite SPA in `frontend/` talks to the committed FastAPI service through a typed client generated from a committed `openapi.json`. Server state lives in TanStack Query hooks; the untyped JSON blobs (`metrics`, `fairness`, `breakdown`) are parsed with zod so a malformed payload shows an error panel instead of crashing. Charts are pure components fed by those parsed types. The API is not changed except for a contract-snapshot script and test.

**Tech Stack:** Vite, React 18, TypeScript (strict), React Router, TanStack Query v5, Tailwind CSS v4, Recharts, zod, openapi-typescript, Vitest + React Testing Library + MSW v2, Playwright (E2E), ESLint.

**Spec:** `docs/superpowers/specs/2026-11-02-fairmatch-design.md` (sections 2, 3, 4, 7: React dashboard with upload, run allocation, comparison, fairness, explanations). Backend contract: `docs/superpowers/plans/2026-11-03-milestone-2-database-and-api.md` and the committed code under `fairmatch/api/`.

## Global Constraints

- Only mainstream libraries; no dependency beyond the Tech Stack line. No UI component kit; build small components with Tailwind. Package manager is npm (Node 22 present, floor Node 20).
- TypeScript `strict: true`; no `any`, no `@ts-ignore`; `npm run typecheck`, `npm run lint`, `npm test` must all pass.
- API calls go to `/api/...` and the Vite dev server proxies `/api` to `http://127.0.0.1:8000` with the `/api` prefix stripped. No CORS changes on the backend.
- The backend contract is the committed `fairmatch/openapi.json`; `frontend/src/api/schema.d.ts` is generated from it (`npm run gen:api`). A backend pytest fails when the committed file is stale.
- Untyped JSON (`RunOut.metrics`, `RunOut.fairness`, `AllocationOut.breakdown`) is parsed with zod schemas in `src/api/types.ts`; a parse failure renders an error panel, never a blank page.
- Pinned wire shapes: `metrics = {fairness_skipped?: string, [algorithm]: {total_score: number, blocking_pairs: number, runtime_ms: number, unallocated: number[]}}` with algorithm keys `hungarian` and `gale_shapley`; `fairness = {[algorithm]: {groups: {group, size, selected, selection_rate, mean_score}[], disparate_impact_ratio, passes_four_fifths, parity_difference}} | null`; `breakdown = {semantic, skill_overlap, experience, education, matched_skills: string[], related_skills: [string, string][], total}`; run `status` is one of `pending | running | done | failed`; education levels are integers 0..4 (0 none, 1 diploma, 2 bachelor, 3 master, 4 doctorate).
- Every non-2xx body is `{"detail": string}`; the client surfaces `detail` verbatim as an error message.
- Token handling: access token kept in `sessionStorage` only (never `localStorage`, never in URLs or logs); role and `exp` are read from the JWT payload for UI routing only, the server is authoritative. A 401 or an expired token clears the session and redirects to `/login` preserving the intended path.
- Privacy: group labels and fairness data appear only on admin pages. Candidate-role UI never fetches or renders demographics.
- API text (names, narratives, skills, error details) is rendered as plain text; `dangerouslySetInnerHTML` is forbidden (lint rule).
- Charts follow the `dataviz` skill: no dual axes (different scales mean small multiples), fixed colour per entity (Hungarian = categorical series 1, Gale-Shapley = series 2, never cycled), legend for two or more series, per-mark tooltips, a table view toggle, status colours only with an icon plus label, text in ink tokens not series colours, 2px gaps between fills, palette validated with the skill's `validate_palette.js` in light and dark.
- Accessibility: every control labelled; async status changes announced with `aria-live="polite"`; keyboard operable; layout usable at 360px width; colour contrast per the validator.
- Tests fail on any `console.error` or `console.warn` during a test (set up once in `src/test/setup.ts`).
- Polling: run status refetches every 1500 ms while `pending` or `running` and stops on `done`, `failed`, unmount, or a 404.
- Client-side limits mirror the API: resume text and posting text up to 20000 characters, title up to 200, files `.pdf` `.docx` `.txt` up to 5 MiB, capacity 1..10000, `min_experience_years` 0..80, `min_education_level` 0..4, group label 1..64 characters, no NUL characters. The server remains the authority and its `detail` is shown on rejection.
- Commands run from `frontend/` unless stated; backend commands run from `fairmatch/`.

## Review Focus

- A token that expires mid-session, or a 401 on any call: user lands on `/login` with the intended path remembered, no redirect loop, no stale cached data shown afterwards.
- A run that never leaves `pending`/`running`: the page keeps polling at the fixed interval without piling up requests, shows how long it has been waiting, and offers a manual refresh; a `failed` run shows its `error` text.
- `metrics`/`fairness`/`breakdown` that are missing keys, null, or have extra keys: error panel or empty state, never an exception that blanks the screen.
- Large results (200 candidates, many opportunities): tables paginate client-side (25 per page) and stay responsive; lists that the API caps at 100 are fetched page by page until exhausted.
- Names, skills or narratives containing `<script>`, emoji, RTL text or 5000 characters: rendered as text, truncated visually with the full text available, layout intact.
- A candidate-role user typing an admin URL: redirected to a forbidden page with no admin data requested; an admin opening the candidate profile page sees a clear admin-appropriate state.
- Double-clicking submit on upload, create or start-run forms: exactly one request is sent.

## Execution Order

Task 1, then Task 2 (both sequential, single agent). Then Tasks 3, 4 and 5 in parallel: they own disjoint files (3: profile page and validation; 4: admin pages and `DataTable`/forms; 5: `components/charts/*`). Then Task 6 (needs `DataTable` from 4 and charts from 5), then Task 7. Parallel agents must not edit `package.json`, `App.tsx`, `src/api/*`, `src/test/*` or `vite.config.ts`: Task 1 installs every dependency listed in the Tech Stack up front, and Task 2 completes routing with stub pages. A task that needs a change to a shared file reports it instead of editing.

---

### Task 1: API contract snapshot and frontend scaffold

**Files:**
- Create: `fairmatch/scripts/export_openapi.py`, `fairmatch/openapi.json`, `fairmatch/tests/api/test_openapi_snapshot.py`, `frontend/` (`package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/api/schema.d.ts`, `src/test/setup.ts`, `src/test/server.ts`, `src/test/fixtures.ts`, `src/App.test.tsx`), `frontend/README.md`
- Modify: root `.gitignore` (add `frontend/node_modules/`, `frontend/dist/`, `frontend/playwright-report/`, `frontend/test-results/`)

**Interfaces:**
- Produces: `python scripts/export_openapi.py [--check]` writes (or with `--check` verifies) `fairmatch/openapi.json` from `create_app().openapi()` using dummy env (`JWT_SECRET=export`, `DATABASE_URL=sqlite://`, `REDIS_URL=fakeredis://`, `CELERY_EAGER=true`), stable key order and 2-space indent.
- Produces npm scripts: `dev`, `build`, `preview`, `test`, `lint`, `typecheck`, `gen:api` (`openapi-typescript ../fairmatch/openapi.json -o src/api/schema.d.ts`).
- Produces `src/test/server.ts` exporting `server` (MSW `setupServer`) and `src/test/fixtures.ts` exporting typed builders `makeRun`, `makeAllocation`, `makeCandidate`, `makeOpportunity`, `makeMetrics`, `makeFairness` (each takes `Partial<T>` overrides and returns a value valid against the generated schema types and the zod schemas of Task 2).
- Vite config: proxy `/api` to `http://127.0.0.1:8000` with the prefix stripped; Tailwind v4 via `@tailwindcss/vite`; Vitest `environment: "jsdom"`, `setupFiles: src/test/setup.ts`.

- [ ] **Step 1: Write failing backend test** `tests/api/test_openapi_snapshot.py::test_committed_openapi_matches_app` (loads `openapi.json`, compares with `create_app().openapi()` under the settings fixtures) and `test_export_script_check_mode_passes`.
- [ ] **Step 2: Run** `pytest tests/api/test_openapi_snapshot.py -v`. Expected: FAIL (file missing).
- [ ] **Step 3: Implement** `scripts/export_openapi.py`, run it to create `openapi.json`, rerun the test. Expected: PASS.
- [ ] **Step 4: Scaffold** `frontend/` with Vite React-TS, install dependencies (`react-router-dom`, `@tanstack/react-query`, `recharts`, `zod`, `tailwindcss`, `@tailwindcss/vite`, dev: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`, `openapi-typescript`, `eslint` + typescript-eslint, `@playwright/test`); do NOT download Playwright browsers yet.
- [ ] **Step 5: Write failing frontend tests** `src/App.test.tsx::test_app_renders_login_when_signed_out` (renders `<App/>` at `/`, expects a heading `Sign in`), `test_console_errors_fail_tests` (setup file throws on `console.error`), and a type-level test file `src/api/schema.test-d.ts` is not needed: instead `npm run typecheck` must pass with fixtures typed against `schema.d.ts`.
- [ ] **Step 6: Run** `npm test` and `npm run typecheck` and `npm run lint` and `npm run build`. Expected: all PASS after implementing the shell (`App` with router, a stub `/login` route heading "Sign in").
- [ ] **Step 7: Commit** `feat(frontend): scaffold dashboard and commit API contract snapshot`.

### Task 2: Typed client, zod schemas, auth and routing

**Files:**
- Create: `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/api/hooks.ts`, `frontend/src/auth/token.ts`, `frontend/src/auth/AuthContext.tsx`, `frontend/src/auth/RequireRole.tsx`, `frontend/src/components/ErrorBoundary.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/pages/Login.tsx`, `frontend/src/pages/Register.tsx`, `frontend/src/pages/Forbidden.tsx`, `frontend/src/pages/NotFound.tsx`, tests beside each (`*.test.ts(x)`)
- Modify: `frontend/src/App.tsx` (routes)

**Interfaces:**
- Produces in `client.ts`: `class ApiError extends Error { status: number; detail: string }`; `apiFetch<T>(path: string, init?: RequestInit & { parse?: (json: unknown) => T }): Promise<T>` (prefixes `/api`, attaches `Authorization: Bearer`, JSON by default, passes `FormData` through untouched, normalises every non-2xx to `ApiError` with `detail` text, on 401 calls the registered `onUnauthorized` handler once); `setUnauthorizedHandler(fn: () => void): void`.
- Produces in `token.ts`: `saveToken(t: string)`, `loadToken(): string | null` (returns null and clears when expired or malformed), `clearToken()`, `decodeToken(t: string): { userId: number; role: "candidate" | "admin"; exp: number } | null` (null for any malformed payload).
- Produces in `types.ts` (zod schemas and inferred types): `RunMetrics`, `RunFairness`, `ScoreBreakdown`, `AlgorithmName = "hungarian" | "gale_shapley"`, `ALGORITHM_LABELS`, plus `parseRunMetrics(json): RunMetrics | null` style safe parsers returning `{ok: true, data} | {ok: false, error: string}`.
- Produces in `AuthContext.tsx`: `AuthProvider`, `useAuth(): { user: {userId, role} | null; login(email, password): Promise<void>; register(email, password): Promise<void>; logout(): void }`; `login` posts form-encoded `username`/`password` to `/auth/login`; `register` posts JSON then logs in.
- Produces `RequireRole` (`<RequireRole role="admin" | "candidate" | "any">`): signed-out users go to `/login?next=<path>`; wrong role goes to `/forbidden` without rendering children or running child queries.
- Produces in `hooks.ts` (TanStack Query, keys prefixed by user id so a user switch never shows stale data): `useMyCandidate`, `useCreateCandidate`, `useCandidates(page)`, `useAllCandidates`, `useCandidate(id)`, `useDemographics(id)`, `useSetDemographics`, `useOpportunities(page)`, `useAllOpportunities`, `useOpportunity(id)`, `useCreateOpportunity`, `useRuns(page)`, `useRun(id)` (polling rule in Global Constraints), `useStartRun`, `useExplanations(runId)`, `useSimilar(opportunityId, limit)`. `useAll*` page through `limit=100` until a short page is returned.
- Routes: `/login`, `/register`, `/profile` (candidate), `/opportunities`, `/opportunities/:id`, `/candidates`, `/candidates/:id`, `/runs`, `/runs/:id` (admin), `/forbidden`, `*` NotFound; admins land on `/runs`, candidates on `/profile`. The `Login` page heading is exactly `Sign in` (Task 1's test depends on it).
- Task 2 also creates one-line stub pages for every page owned by later tasks (`Profile`, `Opportunities`, `OpportunityDetail`, `Candidates`, `CandidateDetail`, `Runs`, `RunDetail`, each a default-exported component that renders its name in an `<h1>`) so `App.tsx` and the route table are complete and later tasks only replace page files, never `App.tsx`. Each stub is replaced by the owning task.

- [ ] **Step 1: Write failing tests:** `token.test.ts` (`decodeToken` valid; malformed base64; non-JSON; missing exp; role "root" -> null; `loadToken` clears an expired token); `client.test.ts` (MSW: 422 `{detail}` becomes `ApiError.detail`; 401 triggers the handler exactly once and throws; FormData posted without a JSON content-type; non-JSON 500 body still yields an ApiError with a generic message; network failure yields an ApiError with status 0); `types.test.ts` (zod accepts the pinned shapes via fixtures; rejects missing `unallocated`, string `total_score`, unknown algorithm key is tolerated and ignored; safe parsers never throw on `null`, `42`, `[]`); `RequireRole.test.tsx` (signed-out redirect with `next`; candidate on an admin route lands on Forbidden and no request is issued; admin passes); `Login.test.tsx` (successful login stores the token and routes by role; wrong password shows the server `detail`; submit disabled while pending; double-click sends one request; 401 from an expired session redirects to `/login`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules. `ErrorBoundary` shows a message with a reload button and logs once to `console.error` only outside tests' guarded path (tests assert the fallback renders using a component that throws, with the console guard temporarily replaced).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): typed API client, zod contracts, auth and role routing`.

### Task 3: Candidate profile page

**Files:**
- Create: `frontend/src/pages/Profile.tsx`, `frontend/src/components/ResumeForm.tsx`, `frontend/src/lib/validation.ts`, `frontend/src/pages/Profile.test.tsx`, `frontend/src/lib/validation.test.ts`

**Interfaces:**
- Consumes: `useMyCandidate`, `useCreateCandidate`, `ApiError`, `Layout`.
- Produces in `validation.ts`: `validateResumeInput({ name, text, file }): string | null` (name 1..200 and non-blank; exactly one of text/file; text <= 20000 and no NUL; file suffix in `.pdf|.docx|.txt` case-insensitive and size <= 5 MiB), plus `educationLabel(level: number): string` ("None", "Diploma", "Bachelor", "Master", "Doctorate", "Unknown" otherwise).
- `Profile` states: loading, no profile yet (form), profile present (name, skills as chips, experience years, `educationLabel`, a notice when `used_fallback` is true explaining that automatic extraction ran in basic mode), error with retry. A 409 on create refetches and shows the profile.

- [ ] **Step 1: Write failing tests** for each validation rule and boundary (20000 vs 20001 chars, 5 MiB vs 5 MiB + 1 byte, `RESUME.PDF`, `a.pdf.exe`, NUL, both/neither input) and `Profile.test.tsx`: 404 on `/candidates/me` shows the form; submit with text sends one multipart request with `name` and `resume_text`; file upload sends the file; server 422 `detail` is shown and the form keeps its values; double-click sends one request; success switches to the profile view with skills; a skill named `<img src=x onerror=alert(1)>` is rendered as text; an admin opening `/profile` sees "Admins manage candidates from the Candidates page" instead of the form.
- [ ] **Step 2: Run** `npm test -- Profile validation`. Expected: FAIL.
- [ ] **Step 3: Implement** the page and form (progress state while uploading, disabled submit when invalid or pending, `aria-live` status region).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): candidate profile and resume upload`.

### Task 4: Admin opportunities and candidates

**Files:**
- Create: `frontend/src/pages/Opportunities.tsx`, `frontend/src/pages/OpportunityDetail.tsx`, `frontend/src/pages/Candidates.tsx`, `frontend/src/pages/CandidateDetail.tsx`, `frontend/src/components/DataTable.tsx`, `frontend/src/components/Pagination.tsx`, `frontend/src/components/OpportunityForm.tsx`, `frontend/src/components/DemographicsEditor.tsx`, `frontend/src/components/SimilarCandidates.tsx`, tests beside each

**Interfaces:**
- Produces `DataTable<T>` props `{ columns: {key: string; header: string; render: (row: T) => ReactNode; sortValue?: (row: T) => string | number}[]; rows: T[]; pageSize?: number (default 25); emptyMessage: string; getRowId: (row: T) => string | number }` with client-side sorting and pagination, `aria-sort` headers, and truncation with `title` for long text.
- Produces `OpportunityForm` (title, posting text, capacity, min experience, min education select; validation per Global Constraints; creates via `useCreateOpportunity`; clears on success; shows server `detail`).
- Produces `DemographicsEditor({ candidateId })` (admin only; loads with `useDemographics`, 404 means "not set", saves with `useSetDemographics`; label 1..64 chars, no NUL; clearly explains the label is used only for the fairness audit and never for scoring).
- Produces `SimilarCandidates({ opportunityId })` (limit selector 5/10/25/50, shows candidate names resolved through `useAllCandidates`, similarity as a percentage with 1 decimal, empty state "No embeddings yet").
- Pages use `RequireRole role="admin"`.

- [ ] **Step 1: Write failing tests:** `DataTable` (sorts ascending/descending, paginates 60 rows into 3 pages, empty message, long text truncated with full text in `title`, HTML in cells rendered as text); `OpportunityForm` (each limit boundary, NUL, inline errors, one request on double submit, server 422 shown, success clears and refreshes list); `Opportunities` page (lists, paginates via API pages, empty state); `DemographicsEditor` (404 shows not-set; save sends `PUT`; 403 shows the server message; label of 64 vs 65 chars); `Candidates`/`CandidateDetail` (admin sees name, skills, `educationLabel`; `used_fallback` badge; demographics editor present); `SimilarCandidates` (sorted as returned, percentages, empty, limit change refetches); a candidate-role user hitting these routes gets Forbidden with zero API calls.
- [ ] **Step 2: Run** `npm test -- Opportunities Candidates DataTable`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and pages.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): admin opportunities, candidates and demographics`.

### Task 5: Charts

**Files:**
- Create: `frontend/src/components/charts/theme.ts`, `ChartFrame.tsx`, `ComparisonCharts.tsx`, `FairnessCharts.tsx`, `BreakdownBar.tsx`, `StatusBadge.tsx`, tests beside each, `frontend/src/components/charts/PALETTE.md` (the validator output for light and dark)

**Interfaces:**
- Consumes: `RunMetrics`, `RunFairness`, `ScoreBreakdown`, `AlgorithmName`, `ALGORITHM_LABELS` from `src/api/types.ts`.
- Produces `theme.ts`: `ALGORITHM_COLORS: Record<AlgorithmName, string>` (fixed series order, validated), `INK` tokens, `SURFACE` per mode; a note in `PALETTE.md` with the exact `validate_palette.js` commands run and their results for light and dark (all FAIL items fixed).
- Produces `ChartFrame({ title, description, table, children })` with a Chart/Table toggle (the table view lists the same data), `role="img"` with an `aria-label` summary on the chart, and a visible legend when two or more series.
- Produces `ComparisonCharts({ metrics: RunMetrics })`: three small-multiple bar charts (total score, blocking pairs, runtime in ms), one bar per algorithm present, each on its own axis (no dual axis), direct value labels, tooltips, 2px gaps, 4px rounded data ends; only algorithms present in `metrics` appear and colours stay with the algorithm when one is missing.
- Produces `FairnessCharts({ fairness: RunFairness | null; skippedReason?: string })`: grouped bars of selection rate by group per algorithm; a disparate-impact panel per algorithm with the 0.8 threshold line, the ratio, and `StatusBadge` (`pass`/`fail` with icon + text, never colour alone); parity difference; empty state with `skippedReason` when `fairness` is null.
- Produces `BreakdownBar({ breakdown: ScoreBreakdown })`: single stacked horizontal bar of weighted contributions (semantic, skills, experience, education) using the sequential/categorical rules, legend, tooltip, table view, and the matched/related skills as text chips below.
- Each chart component renders an inline error panel (not a throw) when handed data that fails its own sanity checks (NaN, negative counts, empty groups).

- [ ] **Step 1: Invoke the `dataviz` skill and read its references before writing chart code; run its `validate_palette.js` on the chosen categorical colours for `--mode light` and `--mode dark`; record the commands and results in `PALETTE.md`.**
- [ ] **Step 2: Write failing tests** (RTL, Recharts mocked only where jsdom cannot measure, e.g. `ResponsiveContainer` replaced by fixed size): `ComparisonCharts` renders three charts with correct values, legend lists both algorithms, a metrics object with only `hungarian` shows one series and keeps its colour, table toggle shows the same numbers; `FairnessCharts` shows the 0.8 line label, `StatusBadge` text "Fails four-fifths rule" with an icon for ratio 0.67 and "Passes" for 0.9, exact-boundary 0.8 passes, `fairness=null` shows the skipped reason, a group with `size 0` is shown without NaN; `BreakdownBar` segments sum to the total within 1e-3 and chips render text safely; invalid data (NaN, negative) renders the inline error panel; `ChartFrame` toggle is keyboard operable and announces the view change.
- [ ] **Step 3: Run** `npm test -- charts`. Expected: FAIL.
- [ ] **Step 4: Implement** the components per the skill's mark specs (thin marks, surface gap, recessive grid, tooltip hit targets larger than marks, dark mode selected not flipped).
- [ ] **Step 5: Render and look at it:** `npm run build`, serve with `npm run preview`, take a screenshot of a page that mounts each chart with fixture data (a dev-only route `/__charts` guarded by `import.meta.env.DEV`), and inspect for label collisions and overflow; record findings in the task report.
- [ ] **Step 6: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(frontend): comparison, fairness and breakdown charts`.

### Task 6: Runs, results and explanations

**Files:**
- Create: `frontend/src/pages/Runs.tsx`, `frontend/src/pages/RunDetail.tsx`, `frontend/src/components/StartRunForm.tsx`, `frontend/src/components/AllocationTable.tsx`, `frontend/src/components/ExplanationPanel.tsx`, `frontend/src/components/RunStatus.tsx`, tests beside each

**Interfaces:**
- Consumes: hooks from Task 2, `DataTable`, charts from Task 5, `educationLabel`.
- Produces `StartRunForm`: algorithm radio (`both` default, `hungarian`, `gale_shapley`), creates via `useStartRun`, on 202 navigates to `/runs/:id`; shows server 422 `detail` (zero candidates, zero opportunities, no seats, size limit) and 503; one request on double click.
- Produces `RunStatus({ run, waitingSince })`: badge with icon + text for each status, `aria-live` announcements, elapsed waiting time, a "Refresh" button, and for `failed` the `error` text.
- Produces `RunDetail` tabs: Results (`AllocationTable`: grouped by opportunity with seats used / capacity, candidate names resolved via `useAllCandidates`/`useAllOpportunities` with the id as fallback label when unknown, score to 3 decimals, per-algorithm switch when both exist, an "Unallocated" list from `metrics[algo].unallocated`), Comparison (`ComparisonCharts`, shown only when both algorithms present, otherwise a single-algorithm summary), Fairness (`FairnessCharts`, with `metrics.fairness_skipped` as the reason), Explanations (`ExplanationPanel`: selecting an allocation shows `reasons` list, `narrative`, a `used_fallback` notice ("template explanation, no LLM"), and `BreakdownBar` from the allocation's `breakdown`). Explanations come from `useExplanations(runId)` joined to allocations by `(algorithm, candidate_id)`.
- `Runs` lists runs (id, algorithm, status badge, created, finished) newest first with pagination; polling applies only on the detail page.

- [ ] **Step 1: Write failing tests:** `StartRunForm` (default `both`, 422 message shown, 503 shown, double click one request, navigates on 202); `RunStatus` (every status has icon + text, failed shows error, waiting time increments with fake timers); `RunDetail` polling with fake timers and MSW: `pending` -> `running` -> `done` stops polling (assert request count), `failed` stops, a 404 stops and shows "Run not found", unmount stops, and requests never overlap; results render capacity usage, unallocated names, id fallback for an unknown candidate id; comparison tab hidden for single-algorithm runs; fairness tab shows the skipped reason; explanation selection shows reasons and breakdown; malformed `metrics` (missing `unallocated`, `null`) shows the error panel while the other tabs still work; 200-candidate fixture paginates at 25 and renders under 2 s; a narrative containing `<script>alert(1)</script>` appears as text.
- [ ] **Step 2: Run** `npm test -- Runs RunDetail StartRunForm`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages and components.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): runs, results, comparison, fairness and explanations`.

### Task 7: End-to-end tests against the real backend and docs

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/helpers.ts`, `frontend/e2e/flows.spec.ts`, `fairmatch/scripts/e2e_prepare.py`, `frontend/e2e/README.md`
- Modify: `frontend/README.md`, `fairmatch/README.md` (frontend section), `frontend/package.json` (`e2e` script)

**Interfaces:**
- Produces `fairmatch/scripts/e2e_prepare.py <db_path>`: creates all tables on a fresh SQLite file at `<db_path>`, creates admin `admin@example.com` / `E2e-Passw0rd!` via `api.cli.create_admin`, prints nothing else.
- Playwright `webServer` entries: backend `python -m uvicorn api.main:create_app --factory --port 8000` run from `fairmatch/` with env `JWT_SECRET=e2e-secret`, `DATABASE_URL=sqlite:///<tmp>/e2e.db`, `CELERY_EAGER=true`, `REDIS_URL=fakeredis://`, `HF_HUB_OFFLINE=1`; frontend `npm run dev -- --port 5173 --strictPort` (proxying to 8000). Global setup runs `e2e_prepare.py`. Tests run single worker, serially.
- Flows in `flows.spec.ts`: (1) candidate registers, signs in, uploads a resume as text, sees skills; a second candidate uploads a real small PDF; (2) admin signs in, creates three opportunities (one capacity 2), sets demographics for both candidates, starts a `both` run, waits for `done`, sees allocations within capacity, the comparison charts with both algorithms, the fairness view with a status badge, opens an explanation with breakdown; (3) run with demographics missing for one candidate shows the exact skipped reason; (4) candidate cannot open `/runs` (Forbidden) and the network log shows no `/runs` request; (5) expired/invalid token in sessionStorage lands on `/login` with `next` preserved; (6) XSS probe: a candidate named `<img src=x onerror="window.__xss=1">` renders as text and `window.__xss` stays undefined; (7) no `console.error` or failed network response with status >= 500 occurs during any flow.

- [ ] **Step 1: Install browsers:** `npx playwright install chromium`. If the download fails, report it and stop this task.
- [ ] **Step 2: Write the failing flows** (they fail until the helpers and servers are wired).
- [ ] **Step 3: Implement** helpers, config and prepare script; run `npm run e2e`. Expected: all flows PASS against the real backend.
- [ ] **Step 4: Run the whole verification:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run e2e` (from `frontend/`), and from `fairmatch/`: `pytest -m "not slow and not llm and not db" -q` and `ruff check .`. Expected: all green.
- [ ] **Step 5: Docs:** `frontend/README.md` (install, dev with the backend, env, scripts, how the contract snapshot works and when to run `gen:api`, role behaviour, token storage note), update `fairmatch/README.md` with a "Dashboard" section.
- [ ] **Step 6: Commit** `feat(frontend): Playwright end-to-end flows and dashboard docs`.
