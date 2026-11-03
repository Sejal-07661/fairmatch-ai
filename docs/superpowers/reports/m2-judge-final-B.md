# Milestone 2 - Final Judge B (live behaviour)

Date: 2026-11-04. Scope: live HTTP behaviour against a real uvicorn process (SQLite file DB, CELERY_EAGER=true, REDIS_URL=fakeredis://, JWT_SECRET=live-test-secret). Read-only on source; scripts and DB under the session scratchpad `jb/` folder.

Status: COMPLETE. **VERDICT: PASS_WITH_FIXES. 1 blocking issue (B1, PostgreSQL-only 500 on /auth/register and /auth/login).** Details are under Check 3 and in the verdict section at the end.

Scratch folder (absolute): `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\jb\`

## Pre-check (source read, no execution)

- Routes read: auth (register, login), candidates (POST, /me, list, /{id}, /{id}/demographics GET/PUT), opportunities (POST, list, /{id}), search (/opportunities/{id}/similar-candidates), runs (POST, list, /{id}, /{id}/explanations), /health.
- Port 8765 free before start (netstat: no match).

## Check 1 - Live end to end over real HTTP: PASS

Setup: `alembic upgrade head` on a fresh SQLite file (tables users, candidates, candidate_demographics, opportunities, allocation_runs, allocations; alembic_version=0001); `python -m api.cli create-admin admin@example.com 'Str0ngPassw0rd!'` printed `1`, row has role=admin and a `$2b$` hash. uvicorn started with `timeout 1500 python -m uvicorn api.main:create_app --factory --port 8765` (Windows PID 28136). **Embedder: the REAL SentenceTransformer (BAAI/bge-small-en-v1.5, HF_HUB_OFFLINE=1)**, no patching. No OPENAI_API_KEY, so the LLM fallback path is exercised.

Results (script `jb/c1_e2e.py`, output `jb/c1_out.txt`; every status recorded):
- 4 registrations 201 (body keys exactly id/email/role), 4 logins 200, admin login 200.
- Profiles: 3 via resume_text, 1 via a real PyMuPDF-generated PDF upload: all 201. Extracted skills were distinct and correct (c1 django/postgresql/python/sql; c2 docker/java/kubernetes/microservices/spring boot; c3 css/html/javascript/react.js/typescript; c4 from the PDF deep learning/machine learning/numpy/pandas/python/pytorch/tensorflow, exp 4.0, edu 4). CandidateOut keys = education_level, experience_years, id, name, skills, used_fallback (no resume_text, no group_label). `/candidates/me` 200 with own id for all 4.
- 3 opportunities 201 (capacities 1, 1, 2); 4 demographics PUT 200 + GET 200 round-trip.
- POST /runs `both` -> 202 `{"id":1,"status":"done"}` (eager mode, 0.19 s); GET /runs/1 -> done, 8 allocations (4 per algorithm). Capacity respected (opp 3 holds 2 of cap 2), each candidate at most once per algorithm, metrics for both algorithms (total_score 3.251955, blocking_pairs 0, unallocated []), fairness present for both (DI 1.0, passes 4/5, groups grpalpha 2/2, grpbeta 2/2).
- GET /runs/1/explanations 200: 8 entries, each with non-empty reasons list, non-empty narrative, used_fallback true, keys exactly algorithm/candidate_id/opportunity_id/score/reasons/narrative/used_fallback. Unique resume marker words, group labels, user emails and `$2b$` absent from explanations, allocations and from the run payload outside `fairness`.
- GET /opportunities/{1,2,3}/similar-candidates 200: 4 entries each, sorted descending, the "right" candidate top for each (opp1 -> c1 0.8226, opp2 -> c2 0.8434, opp3 -> c4 0.7878); `?limit=2` returns 2; unknown opp -> 404 `{"detail":"Opportunity not found"}`.
- POST /runs `hungarian` (run 2) and `gale_shapley` (run 3): only the requested algorithm is persisted in allocations, metrics and fairness.
- Missing demographics: registered a 5th candidate with no demographics, POST /runs both (run 4) -> done, `fairness` null, `metrics.fairness_skipped == "demographics missing for 1 of 5 candidates"` (exact).
- GET /runs list 200, summaries only (no allocations key).
- uvicorn stderr log: 0 lines matching Traceback/ERROR/WARNING/Exception; status counts 31x200, 13x201, 4x202, 1x404, no 5xx.

## Check 2 - Privacy audit across all routes: PASS

Script `jb/c2_privacy.py`, output `jb/c2_out.txt`.
- `/openapi.json` lists 17 operations: GET /health, POST /auth/register, POST /auth/login, POST/GET /candidates, GET /candidates/me, GET /candidates/{id}, PUT/GET /candidates/{id}/demographics, POST/GET /opportunities, GET /opportunities/{id}, GET /opportunities/{id}/similar-candidates, POST/GET /runs, GET /runs/{id}, GET /runs/{id}/explanations.
- Response models (2xx closure): AllocationOut, CandidateOut, DemographicsOut, ExplanationOut, OpportunityOut, RunCreatedOut, RunOut, RunSummaryOut, SimilarCandidateOut, TokenOut, UserOut. Sensitive fields: `group_label` only in DemographicsOut (PUT/GET /candidates/{id}/demographics, admin-only); `email` only in UserOut (POST /auth/register, echoes the caller's own address). No response model has resume_text, password or password_hash. `password` and `resume_text` exist only in request bodies. `fairness` (untyped dict) on RunOut/RunSummaryOut carries group labels: confirmed live it is the only place labels appear in GET /runs and GET /runs/{id} (admin-only).
- Candidate token on every route (own and another candidate's id for {candidate_id} routes): /health 200, register 201, login 200, POST /candidates 409 (already has a profile), /candidates/me 200 with own id and no email, GET /opportunities and /opportunities/{id} 200 (no private data), every other route 403 `{"detail":"Forbidden"}` including all /runs, similar-candidates, demographics and /candidates/{own id}. Undefined methods (DELETE /candidates/me, PATCH /candidates/1, DELETE /runs/1, PUT /opportunities, DELETE /opportunities/1, POST /candidates/me, DELETE /candidates/2/demographics, POST /opportunities/1/similar-candidates) all 405 `{"detail":"Method Not Allowed"}`. No other users' emails, labels, resume markers or hashes in any candidate response.
- No token: 14/14 protected requests 401 `{"detail":"Not authenticated"}` with `WWW-Authenticate: Bearer`. Expired, wrong-secret, alg=none, garbage, unknown-user (sub 99999) and non-integer-sub tokens: 14/14 each 401 `{"detail":"Invalid token"}`. `Authorization: Basic ...` -> 401. A correctly signed token whose role claim says admin for a candidate user -> 403 on admin routes (DB role wins).
- Admin views: /candidates, /candidates/{id}, /runs/{id}/explanations, similar-candidates and /opportunities expose no emails, labels, resume text or hashes.
- My script flagged 2 items that turned out to be false positives on review: the register echo of my own probe address `probe-c2@example.com` matched the substring `c2@example.com`, and the admin GET /runs list carries labels, but only inside `fairness`, which is intended.
- Non-blocking note N1: a token signed with the real secret but with **no `exp` claim** is accepted (14/14 behave like a valid token). Only the server mints tokens and they always carry exp, so this is defence in depth, not a hole. Fix: `jwt.decode(..., options={"require_exp": True})` in `api/security.py:32`.

## Check 3 - Fuzz (86 malformed requests, every route): PASS on SQLite, 1 blocking issue on PostgreSQL by analysis

Script `jb/c3_fuzz.py`, output `jb/c3_out.txt`. An earlier pass of the same list died in my own script (a cp1252 encoding error while writing the output file) after all requests had been sent. The server log for that pass shows no 5xx and no traceback. The table below is from the clean second pass, which used fresh email addresses.

- **0 x 5xx.** No stack traces in any body. uvicorn log: 0 Traceback/ERROR lines.
- Every 4xx body is exactly `{"detail": <str>}`: 422 for validation (bad/truncated JSON, text/plain, array body, wrong types, NUL in name/label/title/posting_text, 300-char name, 20001-char resume, 10k title, 65-char label, capacity 0/1.5/2**70, NaN and 1e309 literals, edu -1, missing fields, form-instead-of-JSON, limit -1/0/101/30 digits, offset -5/2**70, ids -1/0/abc/1.5/%00/2**70/2147483648, wrong-case/null/40k-char algorithm, garbage pdf/docx, non-UTF-8 txt, empty file, whitespace resume, both or neither text/file); 400 for 50k-deep nested JSON (`There was an error parsing the body`) and broken multipart (`Invalid multipart data.`); 401 no auth / 10k-char token / bare `Bearer`; 404 unknown ids and paths; 405 wrong methods; 409 duplicate email with different case/whitespace.
- Duplicate query params: last value wins (`limit=5&limit=abc` -> 422, `limit=abc&limit=5` -> 200). Lower-case `bearer` is accepted (200). Emoji label/email/posting accepted (2xx). bcrypt 5.0.0 handles NUL in passwords correctly: `Passw0rd\x00xyz` logs in, the truncated `Passw0rd` gets 401.
- Not counted as errors: 4 trailing-slash requests (`POST /auth/login/`, `GET /candidates/`, `GET /candidates/me/`, `GET /runs/1/explanations/`) return **307 with an empty body** and `Location` without the slash (Starlette `redirect_slashes`). These are redirects, not error envelopes (non-blocking note N2; set `FastAPI(..., redirect_slashes=False)` in `api/main.py:13` if a strict JSON-only surface is wanted, so they become 404 `{"detail":"Not Found"}`).
- Cosmetic note N3: JSON decode errors read `"9: JSON decode error"`. The numeric location (the character offset) leaks into the message because `api/main.py:29` strips only the string loc parts.

**BLOCKING B1 (PostgreSQL only; proven offline, cannot reproduce on SQLite): unauthenticated 500 on /auth/register and /auth/login.**
- Live on SQLite: `POST /auth/register {"email":"nul\u0000x2@example.com","password":"Passw0rd-xyz!"}` -> **201**, and the stored email contains a NUL. `POST /auth/register {"email":"m"*100000+"@example.com",...}` -> **201**, storing a 100 kB email although the column is `String(320)` (`api/models.py:18`). `POST /auth/login` form `username=c1\x00@example.com` -> 401, which is correct on SQLite.
- On PostgreSQL the same requests fail. psycopg 3 refuses NUL client-side; I verified offline that `StrDumper(str).dump('a\x00b@example.com')` raises `psycopg.DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes`. VARCHAR(320) overflow raises `StringDataRightTruncation`, a `DataError` subclass. `DataError` is not an `IntegrityError`, so `api/routers/auth.py:26` does not catch it and `get_session` re-raises it, giving a **500**. Login fails the same way at the `select` in `api/routers/auth.py:38`. Every other free-text input already rejects NUL and has its length bounded to its column (name 255, title 200, label 64); email is the one path that was missed.
- Fix: in `RegisterIn._email` (`api/schemas.py:12-18`) call `reject_nul(v)` and reject `len(v) > 320` (a basic `"@" in v` check is optional). In `login` (`api/routers/auth.py:37`), when `"\x00" in email or len(email) > 320`, run `verify_password(form.password, _DUMMY_HASH)` and raise 401 without querying. Add tests to `tests/api/test_auth.py` with NUL and 321-char emails expecting 422 (register) and 401 (login).

## Check 4 - Size limits, 20 sequential runs, direct SQLite invariants: PASS

Script `jb/c4_size_runs.py`, output `jb/c4_out.txt`. Each upload was made by a fresh candidate user.
- PDF of 5 MiB + 1 byte (5242881) -> 422 `{"detail":"File too large (size limit is 5 MiB)"}`. TXT of 5 MiB + 1 -> the same 422.
- **TXT of exactly 5 MiB** (5242880 bytes of `python python ...`) -> passes the size gate, then 422 `{"detail":"Resume text exceeds 20000 characters"}`: rejected by the **character cap**.
- **PDF of exactly 5 MiB** (5242880 bytes; a valid one-page PyMuPDF document with an uncompressed random attachment, padded with trailing newlines after `%%EOF`; it re-opens in PyMuPDF with 1 page) -> passes the size gate and **201** (skills `['kafka']`, exp 5.0). This shows the boundary is inclusive (`<= 5 MiB` accepted).
- No `fairmatch-upload-*` temp directories were left in `%TEMP%` before or after (0/0).
- 20 sequential POST /runs (both/hungarian/gale_shapley rotating; ids 5-24): all 202, posted in 2.0 s total, all `done`, no errors. Each run persists exactly the requested algorithms (12 rows for `both`, 6 for a single algorithm, with 6 candidates and 6 seats).
- Direct sqlite3 queries on the live DB: 24 runs, all `done`, no pending/running left. Duplicate `(run_id, algorithm, candidate_id)`: **none**; the `uq_allocation_run_algo_cand UNIQUE (run_id, algorithm, candidate_id)` constraint is present in the migrated schema. Over-capacity `(run, algorithm, opportunity)`: **none**. Allocations attached to runs that are not done: 0. Total rows 186, which matches the expected 8+4+4+8+7x12+13x6.
- Embeddings: all 6 candidates (including the PDF-upload candidates c4 and id 6) and all 5 opportunities (including the emoji-only posting) have a **384-dimensional** JSON vector with L2 norm 1.0.
- uvicorn log still has 0 Traceback/ERROR lines and no 5xx.

## Check 5 - Restart durability: PASS

- Server 1 stopped by killing its `timeout` wrapper (MSYS pid 2028 -> python, Windows PID 28136). Port 8765 was free 2 s later, and `tasklist` shows no PID 28136. Final server-1 log: 0 Traceback/ERROR lines; status totals 82x200, 30x201, 24x202, 8x307, 4x400, 115x401, 26x403, 9x404, 12x405, 5x409, 119x422, **no 5xx**.
- Server 2 started with `timeout 600` on the same DB file (Windows PID 2388); healthy after 5 s.
- After restart: admin login 200, c1 login 200. A token issued before the restart still works (same JWT_SECRET), and `/candidates/me` returns id 1. GET /runs/1 -> 200, done, 8 allocations, fairness for both algorithms, total_score 3.251955, identical to before. /runs/1/explanations 200 (8 entries, used_fallback true). The /runs list holds all 24 runs, all done. similar-candidates 200. A new `both` run (id 25) -> 202, done, 12 allocations. The model reloads lazily in the new process without error.
- Server-2 log: 0 Traceback/ERROR lines (10x200, 1x202).

## Check 6 - Cleanup: DONE

- Server 2 stopped (`kill` of its timeout wrapper, MSYS pid 1775 -> Windows PID 2388). Port 8765 had no listener 2 s later: `netstat -ano | grep :8765` shows only three client-side TIME_WAIT sockets owned by PID 0, and no LISTEN. `ps` shows no uvicorn or timeout process; `tasklist` has no PID 2388 or 28136.
- `jb/live.db` deleted. No `.db` file was created inside `fairmatch/`. The repo working tree is unchanged apart from this report file.
- Scratch leftovers in `jb/`: c1_e2e.py, c1_out.txt, c2_privacy.py, c2_out.txt, c3_fuzz.py, c3_out.txt, c4_size_runs.py, c4_out.txt, c4_resume.pdf (978 B test PDF), state.json (test tokens signed with the throwaway secret `live-test-secret`), pid1.txt, pid2.txt, uvicorn1.log, uvicorn1_before_fuzz2.log, uvicorn2.log.

## Verdict

**VERDICT: PASS_WITH_FIXES. Blocking issues: 1.**

Live behaviour on SQLite was clean across ~400 HTTP requests over two server lifetimes: no 5xx, no tracebacks in the server logs, every 4xx is a `{"detail": str}` envelope, privacy boundaries hold on every route, and run, allocation and embedding invariants hold in the database.

### Blocking

**B1. `/auth/register` and `/auth/login` return 500 on PostgreSQL for an email containing NUL or longer than 320 characters (unauthenticated).**
- Requests: `POST /auth/register` JSON `{"email":"nul\u0000x2@example.com","password":"Passw0rd-xyz!"}`, or `{"email": "m"*100000 + "@example.com", ...}`, or `POST /auth/login` form `username=c1\x00@example.com&password=...`.
- Live response on SQLite: register 201 (the NUL and the 100 kB email are stored as given), login 401.
- On PostgreSQL: psycopg raises `DataError`. For NUL this happens client-side, which I verified offline (`PostgreSQL text fields cannot contain NUL (0x00) bytes`). For more than 320 characters it is `StringDataRightTruncation` against `String(320)` at `api/models.py:18`. `api/routers/auth.py:26` catches only `IntegrityError`, so the error propagates through `get_session` and becomes **500**.
- Fix:
  - `api/schemas.py:12-18` (`RegisterIn._email`): `v = reject_nul(v).strip().lower()`, then `if len(v) > 320: raise ValueError("email must be at most 320 characters")`.
  - `api/routers/auth.py:37-41` (`login`): if `"\x00" in email or len(email) > 320`, call `verify_password(form.password, _DUMMY_HASH)` and raise 401 before the `select`.
  - Tests in `tests/api/test_auth.py`: register with a NUL email and a 321-char email -> 422; login with the same -> 401.

### Non-blocking notes
- N1: tokens without an `exp` claim are accepted if they are signed with the real secret. Add `options={"require_exp": True}` to `jwt.decode` in `api/security.py:32`.
- N2: trailing-slash URLs return 307 with an empty body (Starlette `redirect_slashes`) rather than a `{"detail"}` envelope. Use `FastAPI(..., redirect_slashes=False)` in `api/main.py:13` if strict JSON errors are wanted.
- N3: JSON decode errors read `"<char offset>: JSON decode error"`. `api/main.py:29` keeps integer loc parts. Cosmetic only.
- N4: `RegisterIn.email` has no format check: `😀🚀b@example.com` and strings without `@` are accepted. Optional; adding `"@" in v` alongside the B1 fix is cheap.
- Observation (out of scope, parser taxonomy): the exact-5-MiB PDF resume mentioning "Go, Rust, gRPC, Kafka" extracted only `kafka`.
