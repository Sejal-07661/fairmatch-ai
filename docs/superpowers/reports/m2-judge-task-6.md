# M2 Judge: Task 6 (allocation runs)

Judge run 2026-11-03. Read-only on source. Scratch probes under the session scratchpad.
Scope: uncommitted `api/services/runs.py`, `api/routers/runs.py`, `tests/api/test_runs.py`,
appended `api/schemas.py`, `run_allocation` in `api/worker.py`, `include_router` in `api/main.py`.

VERDICT: PASS_WITH_FIXES (1 blocking issue: SentenceTransformer model reloaded per run in
api/services/embedding.py:88-89, a Task 4 file; Task 6 code itself is correct).

## 1. Suite, lint, protected files

- `python -m ruff check .`: All checks passed.
- `git diff HEAD --stat`: only `api/main.py` (+1/-1, include runs router), `api/schemas.py` (+57),
  `api/worker.py` (+17). Untracked: `api/routers/runs.py`, `api/services/runs.py`,
  `tests/api/test_runs.py`, the task report.
- `git diff HEAD --quiet` over core/, requirements.txt, pyproject.toml, api/db.py, models.py,
  vector.py, security.py, deps.py, config.py, cli.py, routers/auth|candidates|opportunities,
  services/embedding.py, services/profiles.py, migrations/, tests/api/conftest.py: exit 0 (unchanged).
- `pytest tests/api/test_runs.py --durations=15`: 21 passed in 46.6 s; every test, including the
  422 precondition tests that never run the pipeline, takes ~2.3 s (see section 9).
- Full fast suite `pytest -m "not slow and not llm and not db" -q`: 245 passed, 3 deselected,
  1 warning (fitz FutureWarning) in 132 s, exit 0. The 20 slowest tests are almost all in
  test_runs.py at 2.3-2.9 s each.

## 2. Interfaces vs plan Task 6

| Plan item | Implementation | OK |
|---|---|---|
| `validate_run_preconditions(session) -> None`, ValueError per case | services/runs.py:28; 0 candidates / 0 opportunities / seats 0 / size guard | yes |
| `create_run(session, user, algorithm) -> AllocationRun`, pending, algorithm checked | services/runs.py:45 (ValueError on bad algorithm, flush only) | yes |
| `execute_run(session, run_id) -> None`, idempotent, never re-raises pipeline errors | services/runs.py:70 | yes (see 4/5) |
| Celery task `run_allocation(run_id)` with own session | worker.py:72, name `api.run_allocation`, own `SessionLocal()`, closes it | yes |
| `POST /runs` admin, preconditions 422 no row, 202 `{id,status}`, `.delay(run.id)` | routers/runs.py:33; row committed before `.delay` | yes |
| `GET /runs` list | routers/runs.py:54, `list[RunSummaryOut]`, limit 1..100, offset bounded | yes |
| `GET /runs/{id}` RunOut `id, algorithm, status, error, metrics, fairness, created_at, finished_at, allocations` | schemas.py:169-183 | yes |
| `GET /runs/{id}/explanations` `algorithm, candidate_id, opportunity_id, score, reasons, narrative, used_fallback` | schemas.py:157 (exact field set) | yes |
| 404 unknown run; pending/running -> `allocations: []` | `_get_run`, `_allocations` returns [] for every non-`done` status (failed too) | yes |
| RunIn algorithm in `hungarian|gale_shapley|both` | `Literal[...]` -> 422 via the app's validation handler | yes |

AllocationOut fields (plan leaves them open): `algorithm, candidate_id, opportunity_id, score,
breakdown, reasons, narrative, used_fallback`. Admin-only, no resume text, no demographics.
Dead code: `RUN_ALGORITHMS` (schemas.py:132) is never used; `create_run`'s ValueError branch is
unreachable from the router (RunIn Literal rejects first) but correct for direct callers.

## 3. Persistence correctness vs independent `core.pipeline.run_pipeline`

Probe `p3_correctness.py` (TestClient, `create_app()`, sqlite://, fake 384-d embedder, llm None):
7 candidates seeded, candidate id 3 deleted -> ids `[1,2,4,5,6,7]`; 4 opportunities, id 1 deleted
-> ids `[2,3,4]`, capacities `[2,1,1]`; demographics for all. `POST /runs` for `both`,
`hungarian`, `gale_shapley`, compared with an independent `run_pipeline` call on the same inputs
ordered by id ascending:
- Same pairs, scores equal within 1e-9, ids mapped to database ids (e.g. pairs
  `(1,2),(2,3),(4,4),(6,2)`, unallocated `[5,7]`), capacity never exceeded, every candidate either
  allocated or unallocated exactly once.
- `metrics[algo]` has `total_score, blocking_pairs, runtime_ms, unallocated`; total and blocking
  equal the reference; breakdown JSON equals the reference ScoreBreakdown (minus ids);
  reasons/narrative equal the reference explanation for that exact pair; fairness JSON equals
  `dataclasses.asdict(audit)` round-tripped through JSON.
- Single-algorithm runs persist only that algorithm in allocations AND metrics AND fairness.

Probe `p3b_random.py`: 40 randomized scenarios (3-8 candidates, 2-4 opportunities, capacities
from {0,1,2,3}, one candidate and one opportunity deleted for id gaps, demographics present in
~70%, random algorithm), via `create_run` + `execute_run`. Hungarian and Gale-Shapley picked
different pairs in 6 of the 40, so the per-algorithm mapping is exercised. Result: 0 problems
(pairs, scores, unallocated, totals, blocking pairs, coverage, capacities, fairness keys and
values, `fairness_skipped` text `demographics missing for n of n candidates`).

## 4. Idempotency and claim

Code: services/runs.py:71-78. The claim is `UPDATE allocation_runs SET status='running', error=NULL,
finished_at=NULL WHERE id=:id AND status IN ('pending','failed')`, committed, then
`rowcount != 1 -> return`. This conditional WHERE is the right primitive: on PostgreSQL READ
COMMITTED a second concurrent UPDATE blocks on the row lock, re-checks the WHERE against the
committed `running` row and matches 0 rows. Delete of old Allocation rows, insert of new rows and the
`status='done'` update run in one transaction (services/runs.py:145-153).

Probe `p4_idem.py` (run on sqlite:// and on a file SQLite DB):
- a) Done run executed twice more via `execute_run`, plus once via the `run_allocation` task:
  status, `finished_at`, metrics and every allocation row (ids, algorithm, candidate, opportunity,
  score) are identical before and after. No rewrite, no duplicates.
- b) Run forced to `failed` with tampered scores (-1.0) and one row deleted, then re-executed:
  `done`, `error` cleared, the same 8 (algorithm, candidate, opportunity, score) tuples as the
  original, no -1.0 left.
- c) Run forced to `running` (simulates a crashed worker): `execute_run` and the task are no-ops,
  so the run **stays `running` forever**. Nothing reclaims a stale claim, and there is no
  `started_at`/heartbeat column to time it out. Celery's default early ack means a SIGKILLed worker's
  message is not redelivered anyway. Non-blocking, documented in test
  `test_running_run_is_not_reclaimed`. Recommendation: a later migration adds `started_at`, and the
  claim also accepts `status='running' AND started_at < now() - interval` (or an admin
  "reset run" action).
- c2) Unknown run id: no-op, no exception.
- d) File SQLite, 4 threads with a barrier on the same pending run, pipeline slowed by 0.3 s,
  8 trials: every trial ended `done` with exactly 8 rows (4 seats x 2 algorithms), no
  `(run, algorithm, candidate)` group with count > 1, no exceptions leaked.
- `p4b_race_nosleep.py`: 6 threads, no artificial delay, 15 trials: 0 bad trials, 0 exceptions.
- e) Two different runs executed concurrently in threads: both `done`, 8 and 4 rows.
- The unique constraint `(run_id, algorithm, candidate_id)` was never violated (no IntegrityError
  and no `failed` run in any probe).

Note (non-blocking): the claim UPDATE/commit (services/runs.py:71-76) sits outside the try. A DB error
there (e.g. SQLite "database is locked" after the 5 s busy timeout, or a PG connection drop)
propagates out of `execute_run`. The task wrapper (worker.py:83) catches and logs it, so nothing
leaks from the task, and the run is still `pending`, so a retry can claim it.

## 5. Failure paths

Probe `p5_fail.py` (patching `api.services.runs.run_pipeline`; run via the `run_allocation` task
unless noted; columns: task raised?, status, error prefix, error length, allocation rows,
GET status, allocations):

| Injected | Task raised | Status | error | len | rows | GET allocations |
|---|---|---|---|---|---|---|
| ValueError("v"*900) | no | failed | vvvv... | 500 | 0 | [] |
| KeyError("c3") | no | failed | `'c3'` | 4 | 0 | [] |
| RuntimeError("") | no | failed | `RuntimeError` (type-name fallback) | 12 | 0 | [] |
| MemoryError() | no | failed | `MemoryError` | 11 | 0 | [] |
| RuntimeError(700 CJK chars) via POST /runs | 202 | failed | truncated | 500 | 0 | [] |
| NaN on one gale_shapley assignment score | no | failed | `non-finite score` | 16 | 0 | [] |
| inf hungarian runtime_ms | no | failed | `non-finite runtime_ms` | 21 | 0 | [] |
| duplicate assignment -> IntegrityError at autoflush | no | failed | SQLAlchemy message | 500 | 0 | [] |
| SystemExit(3) (BaseException) | **yes** | **running** | - | 0 | 0 | [] |

- Every `Exception` subclass ends `failed` with error <= 500 chars and never leaves `running`. All
  rows roll back (no partial rows, including the NaN-mid-loop and IntegrityError cases). The task
  does not re-raise.
- BaseException (SystemExit/KeyboardInterrupt, i.e. warm-shutdown kill) is deliberately not caught.
  The run stays `running` like a crashed worker (section 4c). Non-blocking.
- `.delay` raising `ConnectionError`: 503 `{"detail": "Task queue unavailable; run marked failed"}`,
  run row `failed` with error `could not enqueue run: task queue unavailable`. The next
  `POST /runs` after the broker "recovers" gives 202 `done`, and `/health` is ok. GET explanations of the
  failed run is `[]`.
- KeyError from a missing label is impossible by construction. services/runs.py:99-105 builds
  `group_of` only when `missing == 0` and keys it `c1..cN` over exactly the same ordered `cands`
  list passed to `run_pipeline`, which generates `c1..cN` for the same list. So the set of group_of keys
  equals the set of candidate ids: no stale ids (core's ValueError) and no missing ids (audit's KeyError).
  Demographics rows for other candidate ids are ignored. Probe: an orphan demographics row
  (`candidate_id=99999`, possible on SQLite without FK enforcement) plus full labels gives `done`,
  with the group size counting only the 4 real candidates.
- Logging: failures log only `run <id> failed: <ExceptionType>` (services/runs.py:84). 48 captured
  records, 0 contain the planted group label. No stored `error` contains the label.
- Theoretical, non-blocking: fairness values are not passed through `_finite`. Core can only produce
  finite values (selection_rate = int/int, mean_score over finite scores, ratio from Fraction), so
  no path exists today. If one appeared, SQLite would store `NaN` and GET would 500 in Starlette's
  `allow_nan=False` encoder.

## 6. Fairness and privacy

Probe `p6_privacy.py` (labels set through `PUT /candidates/{id}/demographics` as admin):
- 3 of 5 labelled: `done`, `fairness` null, `metrics.fairness_skipped ==
  "demographics missing for 2 of 5 candidates"`. 0 of 5: `"demographics missing for 5 of 5 candidates"`.
  Text format matches the plan exactly.
- All 5 labelled with unusual labels (unicode + emoji, `'; DROP TABLE users; --`, 64-char max
  length, `{"x": NaN}`, `c1`): fairness for both algorithms, and the group names round-trip exactly.
- Response text and the raw DB JSON contain no `NaN`/`Infinity` tokens (other than inside the
  label string). Fairness values are Python `float`/`int`/`str` (asdict of core dataclasses, no numpy).
- The planted label is absent from explanations, allocations, metrics, errors, the admin
  candidate list, and all captured logs.
- Candidate role: 403 on `POST /runs`, `GET /runs`, `/runs/{id}`, `/runs/{id}/explanations`
  (also for unknown ids, so no existence oracle). A candidate POST creates no run row. Every
  candidate-accessible response (`/candidates/me`, `/opportunities`, other-candidate and demographics
  endpoints) is free of the label. Unauthenticated: 401 on all four routes.

## 7. Preconditions and size guard

Probe `p7_pre.py` (columns: status, body, run rows created):
- Empty DB: 422 `Cannot start a run: there are no candidates`, 0 rows.
- 0 candidates (1 opportunity): same 422, 0 rows. 0 opportunities: 422 `... there are no
  opportunities`, 0 rows.
- Total seats 0 (all capacities set to 0 directly in the DB): 422 `... total seats across
  opportunities is 0`, 0 rows.
- 5 candidates x 5,000,000 seats = exactly 25,000,000: 202 `pending`, 1 row (`.delay` stubbed so
  the huge run is not executed). 5 x 5,000,001: 422 `Run too large: candidates (5) x total seats
  (5000001) = 25000005 exceeds the limit of 25000000`, 0 rows. The boundary is inclusive, as intended.
- Algorithm `greedy`, missing, `1`, `null`, `Hungarian`, `["both"]`: all 422 `{"detail": str}`
  and 0 rows. Extra body fields are ignored (202). `create_run(..., "nope")` raises ValueError.
- Note (non-blocking): the guard bounds candidates x seats (the Hungarian expansion), but core also
  builds an n x m grid of `ScoreBreakdown` objects plus O(n x seats) blocking-pair work. At the limit
  with capacity-1 postings (5000 x 5000) that is 25 M Python objects, measured at multiple GB
  (section 9). The limit should be much lower in production (see 9).

## 8. Explanations

Probe `p8_expl.py` (5 candidates whose resumes contain the sentinel `QXRESUMESENTINEL`):
- ExplanationOut keys are exactly `algorithm, candidate_id, narrative, opportunity_id, reasons,
  score, used_fallback`. Every `reasons` is a non-empty list, every `narrative` is non-empty, and
  `used_fallback` is true for all (no key). The narrative equals core's fallback
  `"; ".join(reasons) + "."`.
- The sentinel (case-insensitive) and the key `resume_text` are absent from both the explanations
  response and the full RunOut. No demographics field exists in either schema.
- Explanation count equals allocation count per algorithm (3/3 and 3/3; also checked in p3 for
  every scenario). Explanations are persisted on the same Allocation row as the pair, and p3
  verified reasons/narrative equal core's explanation for that exact (candidate, posting) pair.
- `pending`, `running`, `failed`: explanations `[]` and RunOut `allocations []`.
- LLM plumbing: with `get_llm_client` patched to a fake LLM, the narrative is the LLM text and
  `used_fallback` false, so the flag is propagated per row, not hard-coded.

## 9. Performance

Where the test time goes (cProfile of `test_zero_opportunities_422` +
`test_run_both_algorithms_persists_allocations_and_metrics`, 5.5 s total): `bcrypt.hashpw`
9 calls = 4.12 s and `bcrypt.checkpw` 2 calls = 0.91 s, so **91% of the time is bcrypt**
(cost 12, 0.45 s per hash/verify on this machine). `execute_run` = 0.061 s, `run_pipeline` =
0.024 s, `create_app` = 0.009 s, spaCy matcher built once (0.016 s). test_runs.py's `_seed` hashes
a password per candidate user, and `_hdr` logs in through bcrypt. That is why even the 422 tests take
2.3 s. This is test overhead only, not production cost. Non-blocking fix: hash once per module and
mint tokens with `create_access_token` in `_seed`/`_admin`, or monkeypatch `bcrypt.gensalt` to
`rounds=4` in conftest. That would take test_runs.py from ~46 s to a few seconds.

`execute_run` cost vs size (`p9_scale.py`, fake embedder, sqlite://, both algorithms, capacity 2):

| candidates | opportunities | cells | seconds | peak Python mem | SQL statements |
|---|---|---|---|---|---|
| 10 | 5 | 50 | 0.107 | 0.9 MiB | 2 UPDATE, 5 SELECT, 1 DELETE, 20 INSERT |
| 50 | 5 | 250 | 0.119 | 0.4 MiB | same |
| 200 | 5 | 1,000 | 0.380 | 1.1 MiB | same |
| 1000 | 5 | 5,000 | 1.725 | 5.2 MiB | same |
| 200 | 50 | 10,000 | 4.732 | 5.1 MiB | 200 INSERT |

- Linear in candidates x opportunities: 5x the cells (200 -> 1000) gives 4.5x the time. Nothing in the
  service is quadratic. The service issues a constant number of reads (no N+1), and inserts one
  statement per allocation row (the SQLite ORM cannot batch with RETURNING; psycopg on PostgreSQL
  batches via insertmanyvalues).
- The cost is core's n x m scoring. For 200 x 50, `score_matrix` takes 3.4 of 4.7 s, of which
  `skill_overlap` is 2.45 s (209k `taxonomy.canonical` calls, since the candidate skill set is
  re-normalised per pair). `compare_algorithms` takes 0.7 s, including 0.46 s of blocking pairs.
  spaCy parsing is 0.24 s for 250 texts. `get_taxonomy` and the spaCy matcher are cached (one build).
  That is ~0.4-0.5 ms and ~0.5 KB per cell (core limitation, reported, not patched).
- Extrapolated to the size guard: 25 M cells is ~3 h of scoring and ~12 GB of ScoreBreakdown
  objects, so `MAX_CELLS = 25_000_000` (services/runs.py:25) is far too generous. Non-blocking:
  lower it to ~1 M (~7 min, ~0.5 GB) or make it a setting.

**Real embedder path** (`p9b_embedder.py`, `p9c_shared_redis.py`):
- `api/services/embedding.py:88-89` builds `CachedEmbedder(SentenceTransformerEmbedder(), get_redis(), ...)`
  on every `get_embedder()` call. `SentenceTransformerEmbedder` loads its model lazily per
  instance (core/embeddings.py:18-23), and `execute_run` calls `get_embedder()` once per run
  (services/runs.py:112). Counted with a stub: `get_embedder().inner is get_embedder().inner` is
  False, and **one SentenceTransformer is constructed per run whenever any text misses the cache**.
  `embed_profile` constructs one per profile (6 for 6 candidates).
- With a production-like shared Redis (one FakeRedis instance) and the real
  `BAAI/bge-small-en-v1.5`, 20 candidates x 5 opportunities:
  - run 1 (all new): 1.86 s, 1 model load.
  - run 2 (same texts): 0.02 s, 0 loads (cache hit, lazy model never loaded).
  - run 3 (one new candidate): 1.37 s, 1 full model load (1.32 s) to embed a single text.
  Measured load time: 1.3-1.7 s with Hub online (includes Hub HTTP checks per construction) and
  0.4-0.7 s with `HF_HUB_OFFLINE=1`. Each load also allocates the ~130 MB model afresh.
- In fakeredis mode every `get_redis()` returns an isolated FakeRedis, so the cache never hits
  across calls (only tests are affected).
- So the model is **not** created once per process, and a run with any cache miss pays a full
  model reload, which dominates small runs (>95% of run 3). Under this review's criterion (model
  reloaded per run) this is **blocking** for production. The defect is in committed Task 4 code,
  but Task 6 is what makes it a per-run cost. Fix in section "Blocking issues".

## 10. Regressions, plan constraints, fuzz

- Regressions: full fast suite 245 passed (section 1). The only edits to earlier-task files are
  the `include_router` line (main.py), the appended schemas, and the appended task (worker.py).
  `embed_profile` is untouched.
- Plan test list: all 14 Step 1 tests exist by name, plus 7 extras (invalid algorithm, size guard,
  NaN, enqueue failure, running not reclaimed, pagination, pending empty).
- Global Constraints: sync `def` endpoints and sessions; `{"detail": str}` on every error,
  including the custom 503; demographics read only in `_do_run` to build `group_of`, keyed `c1..cN`
  with the mapping owned by the service; LLM never touches allocation; `used_fallback` recorded per
  row; no new dependency; core untouched.
- Fuzz (`p10_fuzz.py`, 38 malformed requests: bad/empty/truncated/non-object/undecodable JSON,
  form body, text/plain, wrong types, NoSQL-style object, NUL, 100k-char algorithm, lone surrogate,
  5000 nested braces, ids `abc`/-1/0/2^31/1e23/1.5/1e3/%00, bad limit/offset, PUT/DELETE/PATCH/POST
  on wrong routes, bad bearer, Basic auth, unknown sub-path): histogram 400 x1, 401 x2, 404 x2,
  405 x4, 422 x29. **0 responses with status 500, and every non-2xx body is exactly `{"detail": str}`.** No run row
  was created by any fuzz case, and `/health` was ok after. The single 400 is FastAPI's built-in
  `There was an error parsing the body` for undecodable bytes (`\xff\xfe\x00`). That shape is
  compliant, but it is 400 rather than 422 (pre-existing app-wide behaviour).
- Dead code: `RUN_ALGORITHMS` (schemas.py:132) is unused. Remove it, or use it for the RunIn
  Literal and `VALID_ALGORITHMS`.
- Core/plan limitation (reported, not patched): `run_pipeline` re-parses `posting_text` and
  `resume_text`, so the admin-entered `min_experience_years` / `min_education_level` and the stored
  skills are ignored by runs. Probe `p10b_misc.py`: an opportunity created with
  `min_experience_years=10, min_education_level=4` and a 1-year candidate scores `experience 1.0,
  education 1.0`. With an OpenAI key, every run also re-calls the LLM for n + m profile extractions.
  The plan prescribes these dict inputs, so this is not a Task 6 defect. It needs a core API that
  accepts pre-parsed profiles (a later milestone).

---

VERDICT: PASS_WITH_FIXES

## Blocking issues (1)

1. **SentenceTransformer model reloaded on every run (and every profile embed) that has a cache
   miss.** `fairmatch/api/services/embedding.py:88-89`:
   `get_embedder()` returns `CachedEmbedder(SentenceTransformerEmbedder(), ...)`, a fresh
   lazily-loading core embedder per call. `execute_run` calls it once per run
   (`api/services/runs.py:112`), and `embed_profile` once per profile (`api/worker.py:61`).
   Measured: 1 model construction per run with any new text, 1.3-1.7 s each with the Hub online
   (0.4-0.7 s offline), plus a fresh ~130 MB allocation and Hub HTTP checks each time. That is
   >95% of a 20x5 run with one new candidate (1.37 s of which 1.32 s is the load). Task 6's own
   code uses the seam correctly. The defect is in committed Task 4 code, so the orchestrator must
   authorise the edit outside Task 6's file set.
   Fix:
   ```python
   from functools import lru_cache

   @lru_cache(maxsize=1)
   def _shared_inner() -> SentenceTransformerEmbedder:
       return SentenceTransformerEmbedder()  # model loads once per process, on first miss

   def get_embedder() -> Embedder:
       return CachedEmbedder(_shared_inner(), get_redis(), dim=EMBEDDING_DIM)
   ```
   Add `test_get_embedder_reuses_one_model` (stub `sentence_transformers.SentenceTransformer`
   with a counter, encode through two `get_embedder()` calls, assert one construction). Tests that
   monkeypatch `get_embedder` are unaffected. Caveat: the shared core embedder's in-process
   `_cache` dict then lives for the process (~3 KB + text length per distinct text). That is
   acceptable at this project's scale. Alternatively, wrap only the model and let Redis be the sole
   cache.

## Non-blocking notes

- Stuck `running` (services/runs.py:73): a worker killed after the claim (or a BaseException such
  as SystemExit) leaves the run `running` forever. A run committed but never enqueued (API crash
  between commit and `.delay`) stays `pending` forever. Recommend `started_at` plus a stale-claim
  timeout in the claim WHERE, or an admin reset endpoint, in a later migration.
- `MAX_CELLS = 25_000_000` (services/runs.py:25) is ~3 h and ~12 GB at the limit, given core's
  n x m ScoreBreakdown grid. Lower it to ~1 M or make it a setting.
- Test speed: ~91% of test_runs.py time is bcrypt (cost 12) in `_seed`/`_hdr`. Hash once per module
  and mint tokens with `create_access_token`, or set `bcrypt.gensalt(rounds=4)` in tests.
- Claim UPDATE errors (services/runs.py:71-76) propagate out of `execute_run`. The task catches them,
  and the run stays `pending`/`failed`, so a retry works.
- Fairness values are not `_finite`-checked. Core cannot produce non-finite values today, but if it
  ever did, GET would 500 in Starlette's `allow_nan=False` encoder.
- Remove the unused `RUN_ALGORITHMS` (schemas.py:132).
- test_runs.py seeds identical candidates/postings, so Hungarian and Gale-Shapley never differ in
  the committed tests. The judge's randomized probe covered the differing case (6/40).
- `get_redis()` creates a new client and connection pool per call (Task 4). Consider caching it.
  Celery publish to an unreachable broker may block the request for the socket/retry timeout; set
  `broker_connection_timeout` / `task_publish_retry_policy` (Task 4 config).
- Admin-entered opportunity minimums and stored skills are ignored by runs (core API limitation,
  section 10).

Probe scripts (session scratchpad): harness.py, p3_correctness.py, p3b_random.py, p4_idem.py,
p4b_race_nosleep.py, p5_fail.py, p6_privacy.py, p7_pre.py, p8_expl.py, p9_scale.py,
p9b_embedder.py, p9c_shared_redis.py, p10_fuzz.py, p10b_misc.py.
