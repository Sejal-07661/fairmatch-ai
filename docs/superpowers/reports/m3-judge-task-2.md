# M3 Task 2 Judge Report (typed client, zod contracts, auth, routing)

Judge: read-only review of the uncommitted Task 2 work against
`docs/superpowers/plans/2026-11-04-milestone-3-dashboard.md` and `fairmatch/openapi.json` / `fairmatch/api/`.
This file is written incrementally; the VERDICT section at the end is filled last.

VERDICT: **PASS_WITH_FIXES**, 3 blocking issues:
- B1: the real app never mounts `AuthProvider`, so production shows only the error fallback.
- B2: the `/profile` guard is `role="candidate"`, which blocks Task 3's required admin state.
- B3: the `safeNext` dot-segment bypass returns `//evil.com`, so a crafted link causes a persistent crash.

Details at the end.

## Check 1: suite, typecheck, lint, build, hygiene greps

- `npm test`: 10 files, **116 passed**, 0 failed (25.6 s). jsdom prints two "Error: kaboom" stack traces to stderr
  from `ErrorBoundary.test.tsx` (jsdom virtual console reporting the uncaught render error); noise only, not a failure.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0. `npm run build`: exit 0 (212.68 kB JS, 68.55 kB gzip).
- `git diff HEAD --stat -- frontend/package.json frontend/package-lock.json`: empty (unchanged).
- `grep dangerouslySetInnerHTML|localStorage|@ts-ignore|: any|as any|<any>` in `frontend/src` (excluding the
  generated schema): one hit only, `src/auth/token.test.ts:60` (`expect(localStorage.length).toBe(0)`, an assertion). PASS.
- `grep .skip|.only|xit(|xdescribe|.todo`: none. `grep console.log|debug|info|TODO|FIXME|debugger`: none.
- ESLint config bans `any`, `@ts-ignore` and `dangerouslySetInnerHTML` (no-restricted-syntax). PASS.
- Build left no new untracked files (`git status` identical to the start).

Result: PASS.

## Check 2: interfaces vs plan Task 2 (static review)

| Item | Plan | Implementation | Status |
|---|---|---|---|
| `ApiError` | `status`, `detail` | `client.ts:3-12` both fields, `message = detail` | OK |
| `apiFetch` | `apiFetch<T>(path, init?: RequestInit & { parse?: (json) => T })` | `client.ts:23-28,59`: `init: ApiInit = Omit<RequestInit,"body"> & { body?, json?: unknown, parse?: (json: unknown) => unknown }`; result is `parse(data) as T` | **MISMATCH** (minor): `parse` is not tied to `T`, so `apiFetch(path, { parse: parseX })` infers `T = unknown` and any `T` can be asserted regardless of the parser (unchecked cast at `client.ts:112`). Extra `json` option is an additive superset. |
| prefix `/api`, Bearer, FormData untouched, non-2xx -> ApiError(detail), 401 -> handler once | yes | `client.ts:59-122` | OK (probed in Check 3) |
| `setUnauthorizedHandler(fn)` | yes | `client.ts:15` | OK |
| token.ts `saveToken/loadToken/clearToken/decodeToken` | `{userId, role, exp} \| null` | `token.ts` all four; sessionStorage key `fairmatch.token` | OK |
| types.ts `RunMetrics`, `RunFairness`, `ScoreBreakdown`, `AlgorithmName`, `ALGORITHM_LABELS`, safe parsers `{ok,data}\|{ok,error}` | yes | `types.ts:17-97`, `parseRunMetrics`, `parseRunFairness`, `parseScoreBreakdown` | OK |
| `AuthProvider`, `useAuth(): {user, login, register, logout}` | login form-encoded `username/password`; register JSON then login | `AuthContext.tsx:46-127` (user also carries `exp`, additive) | OK |
| `RequireRole role="admin"\|"candidate"\|"any"` | signed-out -> `/login?next=`; wrong role -> `/forbidden` w/o children | `RequireRole.tsx` | OK |
| 16 hooks with exact names | listed | all present in `hooks.ts` (`useCandidates/useOpportunities/useRuns` take `PageParams {limit, offset}`; `useRun` returns `{...query, parsed}`) | OK |
| Route table | `/login /register /profile /opportunities(/:id) /candidates(/:id) /runs(/:id) /forbidden *` | `App.tsx:282-294` all present; admins -> `/runs`, candidates -> `/profile` | OK, but see `/profile` below |
| `/profile` guard | Review Focus: "an admin opening the candidate profile page sees a clear admin-appropriate state"; Task 3 test: admin on `/profile` sees "Admins manage candidates from the Candidates page" | `App.tsx:286` `<RequireRole role="candidate">` sends admins to `/forbidden` before `Profile` mounts | **MISMATCH / BLOCKING for Task 3**: Task 3 may not edit `App.tsx`, so its required admin-on-`/profile` test cannot pass. Fix: `role="any"` for `/profile` (Profile page then handles admin). |
| Stub pages default-exported with `<h1>` name | 7 stubs | all 7 present, h1 text = component name | OK |
| Login heading exactly `Sign in` | yes | `Login.tsx:166` | OK |
| **App mounts `AuthProvider`** | `useAuth` must work in the real app | `main.tsx` renders `QueryClientProvider > BrowserRouter > App`; `App.tsx` never renders `AuthProvider`; only the test helper `renderApp` (`src/test/render.tsx:98`) provides it | **suspected BLOCKING** (production app throws `useAuth must be used inside <AuthProvider>`); verified in Check 3 |

(Line numbers in the Check 2 table that read `App.tsx:282-294` / `types.ts:17-97` etc. come from a concatenated listing;
correct per-file references: `App.tsx:35` (`/profile` guard), `client.ts:27,112` (`parse` typing / cast), `main.tsx:16`.)

## Check 3: security probes (throwaway tests run in a scratch copy of `frontend/`, node_modules junctioned)

### 3.0 Production entry point (found while probing routing) -- BLOCKING

- Probe A: `<QueryClientProvider><MemoryRouter><App/></MemoryRouter></QueryClientProvider>` (exactly the provider stack
  `main.tsx` uses). Result: no `Sign in` heading; ErrorBoundary fallback "Something went wrong" rendered;
  console: `[ErrorBoundary] Error: useAuth must be used inside <AuthProvider>` thrown from `Home`.
- Probe B: import `src/main.tsx` itself into a jsdom `#root`. Body text is exactly
  `Something went wrongAn unexpected error occurred. Reloading the page may help.Reload`.
- Probe C: Task 1's committed test (`git show HEAD:frontend/src/App.test.tsx`, which renders `<MemoryRouter><App/></MemoryRouter>`)
  run against the new code: **FAILS** (`useAuth must be used inside <AuthProvider>`). Task 2 rewrote that test to use
  `renderApp` (`src/test/render.tsx:96-100`, which injects `AuthProvider`), masking the regression.
- Impact: `npm run dev` / `npm run build` output shows only the error fallback on every route; nothing is usable.
- Fix: render `<AuthProvider>` inside `App` (wrapping `<Routes>`, inside `ErrorBoundary`; it needs Router + QueryClient
  context which `main.tsx` provides), or add it to `main.tsx:15-17` around `<App />`. Prefer `App.tsx` so tests and prod
  share one tree, then make `renderApp` not double-wrap, and restore a test that renders `App` the way `main.tsx` does
  (or a `main.tsx` smoke test).

### 3a Open redirect / `next` handling -- BLOCKING sanitizer bypass

`safeNext` (`src/auth/redirect.ts:8-23`) table, 34 inputs (evidence in scratchpad `out/safenext.json`):

- Correctly rejected (null): `//evil.com`, `http://x`, `javascript:alert(1)`, ` /ok`, `/ok\n//evil`, `\evil`,
  `/\evil.com` (built with `String.fromCharCode(92)`), `/.\evil.com`, `%2F%2Fevil.com`, `/\t/evil`, `/ \u0000`.
- Kept as harmless same-origin paths: `/%2F%2Fevil.com`, `/%5Cevil.com`, `/@evil.com`, `/;//evil.com`, `/ok?x=//evil`,
  `/ok#//evil`, unicode (` `, ` `, `　`, `／`, `​`) percent-encoded; `/login?next=//evil.com`
  (inner `next` is re-sanitised on the next render, verified).
- **Bypass**: the function validates the *input*, then returns the WHATWG-normalised `u.pathname`, which re-introduces a
  leading `//`. Six inputs return the protocol-relative URL **`//evil.com`**: `/.//evil.com`, `/..//evil.com`,
  `/a/..//evil.com`, `/%2e//evil.com`, `/.%2e//evil.com`, `/%2E%2E//evil.com`.
- What happens with it (real `BrowserRouter` in jsdom, login as admin with `?next=/.//evil.com`): react-router 7.18's own guard
  throws `Error: External navigation is not allowed` inside `<Navigate>`, so the browser is not sent to evil.com
  (the router's guard saves it, not `safeNext`), **but the whole app crashes**. On the full `App`, a signed-in user
  opening `/login?next=%2F.%2F%2Fevil.com` gets the top-level ErrorBoundary fallback ("Something went wrong"). Because
  the token stays in sessionStorage and the URL keeps the `next`, **every reload crashes again**. A crafted link can
  therefore lock a user out of the app. The guard also depends on router internals: any consumer that passes
  `safeNext()` output to `window.location`/`<a href>` gets a real open redirect.
- Fix (`redirect.ts:21`): validate the *output*: `const out = u.pathname + u.search + u.hash; if (out.startsWith("//") || out.startsWith("/\\")) return null; return out;`
  (or reject any input whose pathname contains a `.`/`..`/`%2e` segment). Add the six inputs above to `Login.test.tsx`'s unsafe list.
- Login-loop checks: a 3-deep nested `/login?next=/login?next=...` chain ends at `/runs` after sign-in. A signed-in user on
  `/login?next=%2Flogin` lands on `/profile`. `endSession` does not navigate when already on `/login`
  (`AuthContext.tsx:62`). No loop. PASS.
- Real BrowserRouter with `next=//evil.com` ends at `/runs`. `next=/%2F%2Fevil.com` ends at same-origin `/%2F%2Fevil.com` (NotFound). PASS.

### 3b Token handling -- PASS (7/7 probes)

- Storage: during login, an API call and logout, `Storage.prototype` spies saw **zero** `localStorage` operations. No
  `console.log/info/debug/trace` calls. The token never appears in the router location or `window.location.href`. PASS.
- Expiry timer (fake timers): exp = now + 30 days (above the 2**31-1 ms setTimeout cap). Still signed in after 1 s, after
  2**31 ms, and 2 s before exp; signed out once exp passes. The cap at `AuthContext.tsx:31,84` re-arms correctly.
  exp = 1e300 and `Number.MAX_VALUE` do not fire early (remaining becomes `Infinity`, capped by `Math.min`). PASS.
- exp exactly now: `loadToken()` returns null and clears it (`<=` at `token.ts:70`). exp = now + 0.5 s: signed in at 499 ms,
  signed out at 501 ms. PASS.
- Clock jump past exp (sleep/resume, `Date.now` mocked +2 h): the next `apiFetch` sends **no** Authorization header
  (`loadToken` drops the expired token). The server 401 then ends the session at `/login?next=%2Fruns`. PASS.
- `decodeToken` returns null for: `exp: 1e400` (parses to Infinity), boolean exp, unsafe-integer sub, 4 parts, padded
  base64, non-ASCII token, invalid UTF-8, `__proto__` role smuggling, array role, non-string input. A 2 MB payload decodes
  without error (592 ms, never realistic for a server token).
- Forged `alg:none` admin token with an empty signature: accepted for **routing only** (by design, per plan). The admin
  shell renders, the first request carries the forged token, and the server's 401 clears the token and the query cache
  (0 queries) and lands on `/login?next=%2Fruns`. Nothing else trusts the claims. PASS.
- Note (by design, not a defect): a 403 does not end the session; only 401 does (plan wording).

### 3c 401 handling and cache isolation on user switch -- PASS with one non-blocking defect

- Slow `GET /candidates/me` started as user A (400 ms) -> A logs out -> B logs in: B sees `B-profile`. Afterwards the
  cache holds only `[2,"candidates","me"]`, and `A-SECRET` appears nowhere, even though the server did serve A's response
  (`queryClient.clear()` destroys A's queries and aborts their `signal`; keys are prefixed by user id). PASS.
- Same with `login()` as B called while A is still signed in (no logout): `login` clears the cache too
  (`AuthContext.tsx:103`). PASS.
- 401 burst: `/fast` 401, `/slow` 401 x2 at +200 ms, `/ok` 200 at +100 ms, all concurrent -> handler called **once**. A
  handler that throws does not mask the `ApiError` (`client.ts:88-92`). PASS. The login request's own 401 does not call
  the handler (`client.ts:86`, existing test). A 401 while on `/login` clears the session without navigating (URL stays
  `/login?next=%2Fruns`). PASS.
- **Defect (non-blocking): a stale 401 logs out the next user.** A starts a mutation (`useCreateCandidate`, held open),
  logs out, B signs in. A's request then returns 401: the handler fires and **B is signed out** (user `2` -> `none`).
  Mutations are not aborted by `queryClient.clear()`, and `apiFetch` calls the handler for any 401, even when the token that
  request carried is no longer current. Realistic case: a slow 5 MiB resume upload whose token expired in flight.
  Fix (`client.ts:62,86`): remember `const sentWith = token` and call the handler only when `loadToken() === sentWith`
  (or when `sentWith !== null` and it equals the current stored token).
- Dedupe caveat (note): `burstHandled` resets only when `inflight` reaches 0 (`client.ts:120`). A request that never settles
  (`fetch` has no timeout, and mutations are not aborted) would suppress every later 401 until reload. Low risk.

### 3d Body handling and error normalisation -- PASS

- FormData: no JSON content-type (existing test). Probe: FormData **plus** an explicit `Content-Type: application/json` header
  is still sent as `multipart/form-data; boundary=...` (`client.ts:71-72` deletes the header). URLSearchParams is form-encoded. PASS.
- Matrix (status / detail):
  - HTML 502 -> 502 "The server had a problem. Please try again."
  - empty 500 -> 500 generic
  - JSON without `detail` -> 400 "Request failed (400)."
  - array `detail` -> 422 generic
  - numeric `detail` -> 409 generic
  - whitespace `detail` -> 400 generic
  - 5 MB HTML body -> 502 generic (43 chars)
  - 304 -> generic
  - network error -> 0 "Could not reach the server..."
  - aborted signal -> 0, same text
  - The token appears in no `detail`, `message` or `String(err)`. PASS.
- Note: a 1,000,000-character string `detail` is surfaced verbatim (length 1e6). That matches the plan ("verbatim"). The
  real backend caps 422 text at 500 chars (`api/main.py:36`); consider truncating client-side for safety (non-blocking).
- Real backend error bodies (in-process app, `out/../real/errors.json`) are all `{"detail": string}`, including 405,
  unknown route 404, 401 for a missing or bad token, 403, login 401 "Invalid credentials" and register 422. The client handles all of them.
- `shouldRetry`: status 0 and 5xx are retried at failureCount 0 and 1 and stopped at 2 (= at most 2 retries). 400, 401,
  404, 429, plain `Error` and strings are never retried. PASS.

### 3e Origin / path handling -- PASS

- `apiFetch` always calls `fetch("/api" + path)`, so every probe stays same-origin: `http://evil.com/x` -> `localhost/apihttp://evil.com/x`,
  `//evil.com/x` -> `localhost/api//evil.com/x`, `@evil.com/x`, `https:evil.com` and `\evil.com` likewise. The Authorization
  header never leaves the origin. Note: `/../auth/x` normalises to `localhost/auth/x` (outside `/api`, same origin).
  No hook passes user-controlled path text (ids go through `validId`, `hooks.ts:50`), so this is cosmetic.

## Check 4: zod contracts vs REAL backend payloads -- PASS

- Real payloads: produced in-process (`fairmatch/` app, `JWT_SECRET=x DATABASE_URL=sqlite:// CELERY_EAGER=true
  REDIS_URL=fakeredis://`, fake 384-d embedder). 3 candidates (one stays unallocated), 2 opportunities. Five real
  `RunOut` JSONs: `both` without demographics, `gale_shapley` with partial demographics, and `both`/`hungarian`/`gale_shapley`
  with full demographics. Also `GET /runs` list, explanations and error bodies (script and JSON in the scratchpad: `dump_runs.py`, `real/`).
- Each real file was parsed by the frontend's `parseRunMetrics` / `parseRunFairness` / `parseScoreBreakdown` (every allocation):
  **all ok**, and the parsed output re-serialises **byte-identical** to the raw blob (no key dropped). `fairness: null` with
  `metrics.fairness_skipped: "demographics missing for N of M candidates"` parses. Single-algorithm runs carry only their
  key. `unallocated` holds real candidate ids (`[3]`). The `runs_list` summaries all parse. `related_skills` wire form (from the
  dataclass, `json.dumps(asdict(...))`) is `[["x","y"]]`, which matches `z.tuple([z.string(), z.string()])`. **No mismatch.**
- Adversarial metrics: missing `unallocated`, string `total_score`, NaN, Infinity, `hungarian: null`, `null`, `42`, `[]`, `"str"`,
  `undefined`, numeric `fairness_skipped`, 100k-deep object inside `total_score` -> all `{ok:false}` with a path. A
  100k-deep or cyclic object under an unknown key is stripped (ok). `{simulated_annealing: ...}` alone gives `ok` with `{}`
  (unknown keys ignored). A throwing getter and a hostile Proxy give `{ok:false}`, **never a throw**.
- Fairness: `null` and `{}` ok; `undefined` rejected; unknown algorithm ignored; empty `groups` ok; NaN selection rate,
  string ratio, string boolean and numeric group rejected.
- Breakdown: 3-tuple, 1-tuple, `[str, number]`, object-as-tuple, non-array `matched_skills` and missing `total` rejected;
  an extra key is ignored.
- Accepted but semantically odd (note for Task 5's sanity checks, which the plan assigns to the chart components):
  negative `blocking_pairs` and `runtime_ms`, fractional `blocking_pairs`, and fractional or negative ids in `unallocated` all
  parse ok (`types.ts` uses `z.number()` without `.int()`/`.nonnegative()`). Tightening to
  `z.number().int().nonnegative()` for `blocking_pairs` and `z.array(z.number().int().positive())` for `unallocated`
  would be cheap (non-blocking).
- Note: `parseRunMetrics(null)` is `{ok:false}` (documented in the task report). Pending, running and failed runs have
  `metrics: null`, so Task 6 must gate on `status === "done"` before showing a parse-error panel.

## Check 5: hooks -- PASS (notes only)

- Polling (`hooks.ts:190-209`): the repo tests cover a 1500 ms interval, no overlap when a request outlasts the interval
  (maxInflight 1), and stopping on `done`, `failed`, 404 (1 request, no retry) and unmount. Judge probe: a 401 during
  polling ends the session; the key flips to `[null,...]` (disabled), so polling stops after exactly 2 requests. PASS.
- Retry (`shouldRetry` on every query). Request counts until error: 500 -> 3, 503 -> 3, network -> 3,
  404 -> 1, 422 -> 1, 403 -> 1. Mutation (`useStartRun`) with 500 -> **1** (mutations never retry). PASS.
- `useAll*` paging (`hooks.ts:36-44`): `limit=100`, offset += 100, stops on a short page (repo tests: 230 rows -> offsets
  0/100/200; exact multiple -> one extra empty page). Judge probe against an endless server: stops at **500 requests**, last
  offset 49900, 50,000 rows. PASS. Note: hitting the cap returns truncated data silently; consider throwing or flagging (non-blocking).
- Query keys: all 12 query hooks mounted at once -> every key starts with the user id (3). `useCandidate(0)`, `(-1)`,
  `useRun(NaN)`, `(1.5)`, `useOpportunity(null)`, `useSimilar(0)` issue **no** request (`validId`). PASS.
- Invalidation (observed refetches after each mutation):
  - `useCreateCandidate` -> me, list, all, candidate detail, demographics (all of `[uid,"candidates"]`). Required set met.
  - `useStartRun` -> runs list, plus run detail and explanations. Required set met.
  - `useSetDemographics(5)` -> demographics(5) **and** demographics(6). Required set met.
  - Note: the targeted first call is a no-op. `hooks.ts:122` passes `String(v.candidateId)` ("5") while the key holds the
    number 5, so only the broad follow-up invalidation (`hooks.ts:123`) does the work. Pass the number (widen `invalidate`'s
    `parts` to `(string | number)[]`) and drop the broad call (non-blocking).
- Double submit: no hook-level guard (TanStack mutations do not dedupe). The plan puts the one-request-on-double-click rule
  on the forms (Tasks 3, 4, 6); those tasks must guard with `isPending` or a ref, as `Login`/`Register` do. Not a Task 2 defect.

## Check 6: UI behaviours -- PASS except the `/profile` guard (Check 2)

- RequireRole: signed out -> `/login?next=<path+search>` (repo test). A candidate on each of `/runs`, `/runs/1`,
  `/opportunities`, `/opportunities/1`, `/candidates`, `/candidates/1` of the real `App` gets `Forbidden`, with **0**
  requests (MSW `request:start` listener; `onUnhandledRequest: "error"` also active). A RequireRole-wrapped child that calls
  `useRuns` + `useAllCandidates` issues **no** request for a candidate. PASS.
- **Admin on `/profile` -> `Forbidden`** (`App.tsx:35`). This conflicts with the Review Focus and Task 3's required
  admin-state test (see Check 2, BLOCKING item 2).
- Login: submit disabled while pending and double click -> 1 request (repo tests). Judge probe: Enter pressed twice -> 1
  request (`busy` ref, `Login.tsx:17,23-24`). Server `detail` shown in `role="alert"` inside `aria-live="polite"`. Role-based
  landing and `next` honoured (repo tests; see 3a for the bypass). PASS.
- Register: "Use at least 8 characters." hint linked via `aria-describedby`, `minLength=8`. Note: no client-side 72-byte
  limit. A 37 x "é" (74-byte) password is sent and the server's "password: password must be at most 72 bytes" is shown.
  The server remains the authority, so this is acceptable. Also `minLength` counts UTF-16 units while the server counts
  code points. No confirm-password field (the plan does not require one). Non-blocking.
- Register UX note: if `register` succeeds but the follow-up `login` fails, the account exists and retrying shows
  "Email already registered". Consider routing to `/login` in that case (non-blocking).
- ErrorBoundary: fallback with Reload button; logs once (repo test). The boundary never resets on navigation (only Reload
  recovers). Acceptable.
- Layout: per-role nav (repo App tests). Tab order: first stop "Skip to content", next "Runs". `<main id="main" tabIndex={-1}>`.
  Sign out -> `/login` (no `next`), cache cleared (repo test). Nav uses `Link`, not `NavLink`, so there is no `aria-current`
  on the active item (non-blocking a11y nicety).

## Check 7: test quality -- mutation testing (22 mutants, repo's own 10 test files, scratch copy)

Each mutant was applied to the scratch copy only (`scratchpad/mutate.py`); the original was restored and verified byte-identical afterwards.

| # | Mutant | Result | Killed by |
|---|---|---|---|
| M1 | remove 401 burst dedupe | killed | test_concurrent_401s_call_handler_once |
| M2 | `safeNext` returns `next` unchecked | killed | 8 x test_rejects_unsafe_next_* |
| M3 | no `queryClient.clear()` on login (user switch) | killed | test_user_switch_clears_cache |
| M4 | no cache clear on logout/401 | killed | test_logout_clears_token_cache_and_navigates, test_expiry_timer_logs_out |
| M5 | retry 4xx too | killed | test_stops_on_404 |
| M6 | uncapped `setTimeout(arm, remaining)` | killed | test_expiry_timer_capped_and_cleaned_up |
| M7 | FormData/URLSearchParams get JSON content-type | killed | test_formdata_has_no_json_content_type (+1) |
| M8 | token in `localStorage` | killed | 32 tests (incl. test_never_uses_local_storage) |
| M9 | RequireRole skips role check | killed | 3 tests |
| M10 | login's own 401 triggers logout | killed | test_login_401_does_not_call_handler |
| M11 | drop the 404 stop in `refetchInterval` | **survived** | (404 on first load has no data, so the status rule already stops; no test for running -> 404) |
| M12 | query keys not user-scoped | killed | test_query_keys_prefixed_by_user_id |
| M13 | expired token not cleared by `loadToken` | killed | test_load_clears_expired |
| M14 | remove the 500-page cap | **survived** | no endless-server test |
| M15 | `useSetDemographics` invalidates nothing | **survived** | no test |
| M16 | `useCreateCandidate` invalidates nothing | **survived** | no test |
| M17 | `useStartRun` with `retry: 3` | **survived** | no mutation-retry test |
| M18 | Login without the `busy` ref guard | **survived** | dblClick test is satisfied by `disabled` alone |
| M19 | poll forever | killed | 2 polling tests |
| M20 | 5xx retry bound 2 -> 6 | **survived** | no retry-count test (tests use `retry:false` client, but hooks override with `shouldRetry`; no test counts) |
| M21 | expiry timer never armed | killed | 2 tests |
| M22 | signed-out redirect drops `next` | killed | test_signed_out_redirects_to_login_with_next |

15/22 killed. All 8 behaviours the brief singled out (dedupe, `next` sanitisation, cache clear on user switch, 4xx retry,
uncapped timer, FormData content-type, localStorage, role check) are **killed**. Survivors are coverage gaps, not defects
(non-blocking). Suggested tests: running -> 404 stops polling; endless server stops at 500 pages; the 3 mutation
invalidations (the plan lists `useCreateCandidate` / `useStartRun` / `useSetDemographics` behaviour for later tasks);
mutation 500 -> exactly 1 request; query 500 -> exactly 3 requests; `shouldRetry` table.
Also missing (would have caught the BLOCKING items): a test that renders `App` the way `main.tsx` does, and unsafe-`next` cases with dot segments.

## Check 8: regressions and hygiene

- Backend: `cd fairmatch && python -m pytest tests/api/test_openapi_snapshot.py -q` -> **3 passed**. `npx openapi-typescript`
  regenerated into the scratchpad is byte-identical to the committed `src/api/schema.d.ts` (contract fresh).
- No changes to `fairmatch/`, `main.tsx`, `vite.config.ts`, `src/test/setup.ts`, `src/test/server.ts`, `package*.json`.
- **Task 1 regression**: Task 1's committed `App.test.tsx::test_app_renders_login_when_signed_out` (HEAD version)
  **fails** against the new `App` (no `AuthProvider`). The working-tree version passes only because it was rewritten to
  `renderApp`, which injects the provider. This is the same root cause as BLOCKING item 1. The console-guard test still passes.
- `src/test/fixtures.ts` now imports types from `src/api/types` (zod-inferred `Metrics`/`Fairness`). Builders keep the
  plan's names and pass typecheck. OK.
- No `console.log`, `debugger`, TODO/FIXME, `.only`/`.skip` in `frontend/src`. The only `console.error` is ErrorBoundary's
  single log (plan-sanctioned).
- jsdom prints "Error: kaboom" stack noise during `ErrorBoundary.test.tsx` (stderr only; non-blocking).

## VERDICT: PASS_WITH_FIXES (3 blocking issues)

The client, token, zod, hooks and 401 machinery are solid: real backend payloads parse losslessly, every security probe
on storage, timers, forged tokens, cache isolation and origin handling passed, and 15/22 mutants are killed, including all 8
the brief named. Three issues must be fixed before Tasks 3-5 start, because they code against this tree and may not edit `App.tsx`.

### Blocking

- **B1. The real app never mounts `AuthProvider`; production shows only "Something went wrong".**
  `frontend/src/main.tsx:15-17` renders `<App />` inside QueryClientProvider + BrowserRouter only, and
  `frontend/src/App.tsx` (no `AuthProvider` anywhere) calls `useAuth` via `Home`, `Login`, `RequireRole` and `Layout`.
  `useAuth` throws `useAuth must be used inside <AuthProvider>`. Verified by importing `main.tsx` in jsdom (body =
  ErrorBoundary fallback). Task 1's committed App test fails against the new code; the rewritten test hides it via
  `renderApp` (`src/test/render.tsx:96-100`).
  Fix: wrap `<Routes>` in `<AuthProvider>` inside `App` (`App.tsx`, inside `<ErrorBoundary>`). Stop `renderApp` from adding a
  second provider when rendering `App` (e.g. give it a `withAuth` option, or have tests that need a bare provider
  render it themselves). Add a test that renders `<QueryClientProvider><MemoryRouter><App/></MemoryRouter></QueryClientProvider>`
  exactly like `main.tsx` and expects the `Sign in` heading.
- **B2. `/profile` is guarded `role="candidate"`, so an admin gets Forbidden and Task 3 cannot meet its spec.**
  `frontend/src/App.tsx:35`. Review Focus requires "an admin opening the candidate profile page sees a clear
  admin-appropriate state", and Task 3's mandated test expects "Admins manage candidates from the Candidates page" on
  `/profile`. `Profile` never mounts for admins, and Task 3 is forbidden to edit `App.tsx`.
  Fix: `<RequireRole role="any"><Profile /></RequireRole>` and update the App test. Candidate-only data fetching then
  becomes the Profile page's job; Task 3 already owns that branch.
- **B3. `safeNext` can return a protocol-relative `//evil.com`; a crafted login link crashes the app persistently.**
  `frontend/src/auth/redirect.ts:21` returns the URL-normalised `u.pathname`, which collapses dot segments after the
  `startsWith("//")` check ran on the raw input. `/.//evil.com`, `/..//evil.com`, `/a/..//evil.com`, `/%2e//evil.com`,
  `/.%2e//evil.com` and `/%2E%2E//evil.com` all return `//evil.com`. React Router 7.18 refuses the external target with
  `Error: External navigation is not allowed`, so there is no actual redirect today, but the top-level ErrorBoundary
  replaces the whole app. Since the token persists and the URL keeps `next`, every reload of
  `/login?next=%2F.%2F%2Fevil.com` crashes again for a signed-in user. The function's own contract ("same-origin relative path") is broken.
  Fix: check the output, e.g. `const out = u.pathname + u.search + u.hash; return out.startsWith("//") || out.startsWith("/\\") ? null : out;`.
  Add those six inputs to `Login.test.tsx`'s unsafe list.

### Non-blocking (recommended)

1. `apiFetch` signature deviates from the pinned interface: `parse?: (json: unknown) => unknown` plus an unchecked
   `parse(data) as T` (`client.ts:27,112`). Use `init?: ApiInit<T>` with `parse?: (json: unknown) => T` so `T` is inferred
   from the parser and cannot be asserted independently.
2. A stale 401 from a previous user's in-flight mutation signs out the next user (3c). Only call the handler when the
   token that request carried is still the stored token (`client.ts:62,86`).
3. `burstHandled` resets only when `inflight` hits 0. A never-settling request (no fetch timeout, mutations not aborted) would
   suppress later 401 handling until reload (`client.ts:21,120`).
4. `useSetDemographics` targeted invalidation is a no-op (`String(id)` vs numeric key, `hooks.ts:122`). The broad follow-up
   call does the work and also refetches every other candidate's demographics.
5. `useAll*` silently truncates at 500 pages (`hooks.ts:38`). Surface an error or a flag.
6. zod accepts negative and fractional `blocking_pairs` and `runtime_ms`, and fractional or negative `unallocated` ids (`types.ts`).
   Tighten with `.int().nonnegative()` and `.int().positive()`, or make sure Task 5's sanity checks cover them.
7. Server `detail` is surfaced verbatim at any length (a 1 MB detail gives a 1 MB message). Consider a client-side cap (e.g. 500 chars).
8. Register: no client-side 72-byte check (the server message is shown). `minLength` counts UTF-16 units. If register
   succeeds and login fails, a retry hits 409.
9. Nav lacks `aria-current` (use `NavLink`). The ErrorBoundary never resets on route change.
10. Test gaps from surviving mutants M11, M14, M15, M16, M17, M18 and M20 (see Check 7).
11. FYI for Task 6 (backend, not Task 2): under SQLite, `created_at`/`finished_at` come without a UTC offset
    (`"2026-11-04T09:16:24.526954"`), so `new Date()` parses them as local time.
12. jsdom "Error: kaboom" stderr noise in `ErrorBoundary.test.tsx`.

### Housekeeping

All judge probes, mutants and generated payloads live in the scratchpad (`fe/` copy with a node_modules junction,
`out/*.json`, `real/*.json`, `dump_runs.py`, `mutate.py`). Nothing was written under `frontend/` or `fairmatch/`. The only
repo change is this file.
