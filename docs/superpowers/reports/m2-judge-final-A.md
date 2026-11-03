# Milestone 2 Final Judge A

Date: 2026-11-04. Scope: Tasks 1-7 (Task 7 uncommitted). Read-only review.

VERDICT: PASS_WITH_FIXES (3 blocking: B1 README setup, B2 .gitignore, B3 empty JWT_SECRET; see the Verdict section at the end)

## Check 1: protected files, ruff, targeted tests

- `git diff HEAD --stat -- core requirements.txt pyproject.toml api/db.py api/models.py api/vector.py api/security.py api/deps.py migrations` (both repo-root and `fairmatch/` prefixes): empty. Protected files unchanged.
- `git status --short`: only README.md, api/main.py, api/schemas.py modified; new api/routers/search.py, tests/api/test_end_to_end.py, tests/api/test_search_pg.py, plus two report files under docs/.
- `python -m ruff check .` -> `All checks passed!`
- `python -m pytest tests/api/test_end_to_end.py tests/api/test_search_pg.py -q -rs` -> `8 passed, 1 skipped in 17.17s`; skip reason: `set TEST_DATABASE_URL (start Postgres with docker compose -f docker-compose.dev.yml up -d)`.

Result: PASS.

## Check 2: search.py vs plan Task 7 (SQLite branch)

Code review of `fairmatch/api/routers/search.py`:
- Path `GET /opportunities/{opportunity_id}/similar-candidates` (router prefix `/opportunities`, line 13/49); `IdPath` (1..PG_INT_MAX) on the id.
- Admin only via `Depends(require_role("admin"))` (line 52); limit `SimilarLimitQuery = Annotated[int, Query(ge=1, le=50)]`, default 10 (line 54, schemas.py:186).
- 404 `{"detail": "Opportunity not found"}` for unknown opportunity (line 57-58); `opp.embedding is None` -> `[]` (line 27-28).
- Dialect branch on `session.bind.dialect.name == "postgresql"` (line 29); SQLite branch (line 41-43) selects `Candidate.id, Candidate.embedding WHERE embedding IS NOT NULL` and uses Python `_cosine`; `cosine_distance` appears only inside the PG branch.
- Output rounded to 6 decimals, sorted `(-similarity, candidate_id)`, sliced to `limit` (line 44-46); `response_model=list[SimilarCandidateOut]` with only `candidate_id`, `similarity`.

Probe `scratchpad/probe_search_sqlite.py` (36 assertions, 0 failures):
- `_cosine` vs numpy on 200 random 384-d vectors with norms 1e-3..1e3: max abs err 4.2e-17 (<= 1e-9).
- Zero candidate vector -> 0.0; both zero -> 0.0; identical -> 1.0; opposite -> -1.0.
- `Vector.comparator_factory.cosine_distance` monkeypatched to raise: never called on SQLite.
- Through the HTTP app: duplicates tie broken by lower id; q and 1000*q tie at 1.0, lower id first; zero vector 0.0; None-embedding candidate excluded; limit=50 with 6 embedded candidates returns 6; default limit OK; all-zero opportunity embedding -> every similarity 0.0, ordered by id, no NaN; opportunity with no embedding -> `[]`; unknown id 404 with str detail; limit 0/51/-1/1.5/abc/'' -> 422 str detail; limit 1 and 50 -> 200; no token 401; candidate token 403; id 9999999999999 -> 422; no `NaN`/`Infinity` anywhere in the response text.
- Non-blocking: `_cosine` returns 0.0 (finite, but wrong value) for vectors whose squared norm underflows (1e-200 entries) or overflows (1e200 entries). Stored embeddings are L2-normalised, and `EmbeddingType` rejects non-finite values, so real data never gets near this.
- Non-blocking: ties are broken on the 6-decimal rounded value. On SQLite the cut at `limit` happens after rounding. On PostgreSQL SQL `LIMIT` cuts on the exact float distance and Python then re-sorts the rounded values. Results can differ only when two candidates' similarities agree to 6 decimals right at the limit boundary.

Result: PASS.

## Check 3: PostgreSQL branch offline (statement compile, type processors)

Probe `scratchpad/probe_search_pg_compile.py` (all assertions PASS). A fake session whose `bind.dialect.name == "postgresql"` captured the exact statement `similar_candidates` executes. That statement was then compiled with `postgresql.dialect()` and with `postgresql+psycopg`:

```
SELECT candidates.id, candidates.embedding <=> %(embedding_1)s AS anon_1
FROM candidates
WHERE candidates.embedding IS NOT NULL ORDER BY candidates.embedding <=> %(embedding_1)s, candidates.id
 LIMIT %(param_1)s::INTEGER
```
- `<=>` (cosine distance), `IS NOT NULL`, deterministic `ORDER BY distance, candidates.id`, and `LIMIT` are all present. The query vector and the limit are bound parameters (`embedding_1`, `param_1`). No user value is interpolated into the SQL text, and the path id is only used in `session.get`.
- The bound vector goes through `EmbeddingType.process_bind_param` and then pgvector `VECTOR.bind_processor` to the text `'[0.5,...]'` (384 values). With `literal_binds=True` it renders `'[0.5,...]'` and `LIMIT 7`.
- Similarity is `1.0 - float(d)` in Python (search.py:39). Fake rows with `None` and `NaN` distances map to 0.0, so no NaN escapes. The Python re-sort keeps `(-sim, id)`.
- `INSERT INTO candidates (...)` with a 384-d float32 numpy embedding compiles with a plain `%(embedding)s` (no cast), and the bind processor yields a 384-value text vector.
- `EmbeddingType` on postgresql and postgresql+psycopg:
  - the impl is `VECTOR(384)`;
  - list, numpy float64 and numpy float32 inputs all serialise to pgvector text;
  - `None` passes through as `None`;
  - 383-d, 385-d, NaN, inf and 2-D inputs are rejected with `ValueError`/`TypeError`;
  - the result processor maps the text form and a `pgvector.Vector` object (what a `register_vector`'d connection returns) to `list[float]`.
- psycopg 3.3.7 default `str` dumper is `StrDumperUnknown` (OID 0). The text vector is therefore sent as `unknown`, and PostgreSQL resolves it to `vector` from the column or operator context. So `pgvector.psycopg.register_vector` is NOT required with the SQLAlchemy pgvector type (pgvector 0.5.1 `VECTOR` does its own text bind/parse). `api/db.py` builds a plain `create_engine(url, pool_pre_ping=True)` with no connect hook, and that is sufficient.
- Non-blocking: the `candidates.id` tie-break in ORDER BY means the planner cannot satisfy the whole ordering from the HNSW index alone. With a large table it may use incremental sort over the index or a seq scan. HNSW is approximate in any case, so large-table results may differ slightly from the exact Python ranking. This does not affect the dev/test data sizes.

Result: PASS.

## Check 4: tests/api/test_search_pg.py review and Alembic offline rendering

Review of the test, read as if it runs against real PostgreSQL tomorrow:
- DB URL: the test reads `TEST_DATABASE_URL`, sets `DATABASE_URL` to the same value, clears the settings cache, and builds its own `create_engine(url)`. The README gives `postgresql+psycopg://...`, which matches the installed driver: psycopg 3.3.7 is installed and `psycopg2` is NOT. A bare `postgresql://` URL would fail with `ModuleNotFoundError: psycopg2`. Non-blocking: the README is correct, but the test does not normalise or guard the URL.
- Schema lifecycle: `command.upgrade(cfg, "head")` runs `CREATE EXTENSION IF NOT EXISTS vector`, the tables and both HNSW indexes. `command.downgrade(cfg, "base")` in `finally` drops the indexes, tables and extension. The ORM session is closed (`with sessionmaker(...)() as s`) before downgrade, so `DROP TABLE` cannot block on the test's own locks. `engine.dispose()` and `get_settings.cache_clear()` run in a nested `finally`, and the autouse `settings_env` fixture calls `reset_engine_cache()` and clears settings at teardown. `api.db.get_engine` is never populated with the PG URL inside the test.
- pgvector adapter: no `register_vector` is needed. pgvector 0.5.1 `VECTOR` binds text and parses text or `Vector`, and psycopg3 sends `str` as OID 0 (see check 3). `api/db.py:23` `create_engine(url, pool_pre_ping=True)` is enough.
- Determinism: the seed-7 data has a minimum similarity gap of 4.5e-3. A simulated pgvector float32 accumulation differs from the Python value by at most 5.3e-8, and the order is identical after 6-decimal rounding. The 1e-5 tolerance is therefore sound and the order assertion is not flaky. The None-embedding candidate is inserted and correctly expected to be excluded.
- Leftover state: if `test_migrations_pg` fails between upgrade and its non-`finally` downgrade, the DB stays at head. This test's upgrade is then a no-op and its own `finally` downgrade cleans up. Non-blocking: `test_migrations_pg.py` should also downgrade in `finally`.
- SKIP behaviour now: `SKIPPED [1] tests\api\test_search_pg.py:17: set TEST_DATABASE_URL (start Postgres with docker compose -f docker-compose.dev.yml up -d)`. The skip is applied by `pytest_collection_modifyitems` in conftest for `@pytest.mark.db`, and the marker is registered in pyproject.toml.
- Alembic offline with `DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch` and `JWT_SECRET` set:
  - `alembic upgrade head --sql` exits 0 and renders 95 lines in one transaction: `CREATE TABLE alembic_version`, `CREATE EXTENSION IF NOT EXISTS vector`, the 6 tables, `embedding VECTOR(384)` on candidates and opportunities, two `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`, and `INSERT INTO alembic_version ... '0001'`.
  - `alembic downgrade head:base --sql` exits 0 and renders: DROP the 2 indexes, DROP the 6 tables in FK-safe order, `DROP EXTENSION IF EXISTS vector`, DELETE the version row.
- Note for check 5: without `JWT_SECRET`, `alembic upgrade head` fails with `RuntimeError: JWT_SECRET is required`, because `migrations/env.py` calls `get_settings()`.

Result: PASS (non-blocking notes only).

## Check 5: README accuracy

Verified as accurate:
- Imports: `python -c "from api.main import create_app"` and `python -c "from api.worker import celery_app"` both import cleanly even without `JWT_SECRET` (settings are read only when `create_app()` runs).
- Celery: `celery_app.main == "fairmatch"`, registered tasks `api.embed_profile` and `api.run_allocation`, so `celery -A api.worker.celery_app worker` is the right module path.
- `uvicorn api.main:create_app --factory`: `create_app` is a zero-argument factory.
- `python -m api.cli create-admin EMAIL PASSWORD`: an argparse subcommand with positional email and password; it prints the id and exits 2 on `ValueError`.
- Endpoint table vs `create_app().openapi()`: all 17 operations listed, and no undocumented route.
- 202/503 on `POST /runs` (runs.py:33/48), 409 register / profile, and 401 `Invalid credentials` / `Invalid token` match the code.
- Limits: 5 MiB upload (candidates.py:32), capacity <= 10000 (schemas.py:45,95), cells <= 25,000,000 (services/runs.py:25), limit 1..50.
- Env vars match `api/config.py`. `OPENAI_MODEL` default `gpt-4o-mini` matches `core/llm.py:41`. `TEST_DATABASE_URL` uses `postgresql+psycopg://`, which is correct because psycopg2 is not installed.
- Milestone 1 sections (demo, tests command, Hungarian rationale) are unchanged and still accurate. "Next steps" (React dashboard) is consistent with the module table. Nothing stale.

Issues:
- **B1 (blocking, doc): README.md:53-60 Setup fails as written.**
  - Line 56 `alembic upgrade head` raises `RuntimeError: JWT_SECRET is required` (reproduced), because `migrations/env.py` calls `get_settings()`.
  - Even with `JWT_SECRET` set, `DATABASE_URL` defaults to `sqlite:///./fairmatch.db` (config.py:10). So the Postgres started on line 55 is never used by alembic, uvicorn or celery unless the user exports `DATABASE_URL`.
  - Fix: add, before `alembic upgrade head`:
    ```bash
    export JWT_SECRET=change-me
    export DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch
    ```
    Note they must be set in every terminal (API and worker). Also add `ACCESS_TOKEN_MINUTES` default 60 and `REDIS_URL` default `redis://localhost:6379/0` to the env table.
- **N1 (non-blocking, doc): README.md:81-82 roles and error codes for the candidate routes.**
  - `POST /candidates` and `GET /candidates/me` accept role `candidate` OR `admin` (`require_role("candidate", "admin")`, candidates.py:35). Verified: an admin `POST /candidates` returns 201 and `GET /candidates/me` returns 200.
  - On `POST /candidates`, 403 cannot occur, and 413 is never produced (an oversized file gives 422 `File too large (size limit is 5 MiB)`).
  - A `resume_text` form field over 1 MiB gives **400** `Field exceeded maximum size of 1024KB.` (Starlette multipart limit), and 400 is not listed.
  - Fix: Role `candidate or admin`; Errors `400, 401, 409, 422` for `POST /candidates`.
- N2 (non-blocking): on Windows (this machine), Celery's default prefork pool is unsupported. Suggest `celery -A api.worker.celery_app worker --pool=solo` in the README.
- N3 (non-blocking): the README's "Every non-2xx response has the shape `{"detail": ...}`" holds for HTTPException and validation errors. An unhandled exception still yields Starlette's plain-text 500.

Result: FIX NEEDED (B1). The rest is accurate.

## Check 6: spec coverage (spec sections 6-9, milestone 2)

| Spec requirement | Implemented in | Covered by |
|---|---|---|
| §6 `users` | Task 2 `models.User`, migration 0001 | test_models::test_create_all_and_roundtrip, test_email_unique |
| §6 `candidates` (profile, skills, embedding vector) | Task 2 `Candidate`, `EmbeddingType` (VECTOR(384) on PG) | test_models roundtrip / embedding tests; test_candidates::test_embed_profile_task_stores_vector_and_is_idempotent |
| §6 protected attributes in separate `candidate_demographics` | Task 2 `CandidateDemographics`; Task 5 admin-only PUT/GET | test_candidates::test_candidate_cannot_read_demographics_403, test_admin_sets_and_reads_demographics, test_candidate_out_has_no_demographics_field; e2e asserts labels absent from explanations |
| §6 `opportunities` (requirements, seats, embedding) | Task 2 `Opportunity` (required_skills, capacity, min_*), Task 5 | test_opportunities::* |
| §6 `allocation_runs` (algorithm, status, metrics) | Task 2/6 `AllocationRun` (+error, fairness, finished_at) | test_runs::test_run_both_algorithms_persists_allocations_and_metrics |
| §6 `allocations` (run_id, candidate_id, opportunity_id, score, breakdown, explanation) | Task 2/6 `Allocation` (breakdown, reasons, narrative, used_fallback; unique run/algo/candidate) | test_models::test_allocation_unique_per_run_algorithm_candidate, test_runs::test_allocation_ids_map_back_to_database_ids |
| §6/§3 pgvector HNSW index | migration 0001 (PG only, vector_cosine_ops) | test_migrations_pg (db, skipped); offline `--sql` render verified (check 4) |
| §7 `POST /auth/login` | Task 3 | test_auth::test_register_then_login_returns_token, test_login_unknown_email_and_wrong_password_same_401_message, token tests |
| §7 `POST /candidates` (+resume upload) | Task 5 (text or .pdf/.docx/.txt, 5 MiB) | test_candidates::test_upload_txt_file, test_upload_pdf_and_docx, test_bad_files_422_nothing_persisted, test_oversized_file_422 |
| §7 `POST /opportunities` | Task 5 | test_opportunities::test_admin_creates_opportunity, test_capacity_zero_422 |
| §7 `POST /runs` -> 202 + run id | Task 6 | test_runs::test_run_both_algorithms..., test_invalid_algorithm_422, e2e |
| §7 `GET /runs/{id}` (status, allocations, fairness, comparison) | Task 6 `RunOut` (metrics per algorithm: total_score, blocking_pairs, runtime_ms, unallocated) | test_runs::test_run_both..., test_pending_run_returns_empty_allocations, e2e |
| §7 `GET /runs/{id}/explanations` | Task 6 | test_runs::test_explanations_endpoint_returns_reasons_without_resume_text, e2e |
| (plan) similarity search | Task 7 search.py | test_end_to_end::test_similar_* (7 tests), test_search_pg (db, skipped) |
| §8 unparseable resume -> 422 with reason | Task 5 `_extract_text` | test_candidates::test_bad_files_422_nothing_persisted, test_unsupported_suffix_422_nothing_persisted, test_empty_text_422, test_nul_rejected_422 |
| §8 LLM failure -> spaCy fallback flagged in profile | core.parser (except -> fallback), `Candidate.used_fallback` stored by services/profiles.py | core tests/test_parser.py:38 (raising LLM); API: test_candidates::test_candidate_creates_profile_from_text (no-key path only) |
| §8 run failure -> `failed` with message | Task 6 `execute_run` | test_runs::test_pipeline_exception_marks_run_failed_with_message, test_nan_score_marks_run_failed, test_enqueue_failure_503_and_run_failed |
| §8 seats = 0 or no candidates validated up front | Task 6 `validate_run_preconditions` | test_runs::test_zero_candidates_422_no_run_row, test_zero_opportunities_422, test_total_seats_zero_422, test_size_guard_422_states_limits |
| §9 API tests with a test Postgres container | `@pytest.mark.db` tests (test_migrations_pg, test_search_pg) + docker-compose.dev.yml | SKIPPED here (Docker off). Accepted limitation |
| §9 CI ruff + pytest | Milestone 4 | n/a for M2 |

Gaps (all non-blocking for M2):
- G1: spec §6 says `skills JSONB` and `breakdown JSONB`, but the PG migration renders `JSON` (up.sql:27,48,62,63,77,78). The plan (Task 2) specified `JSON`, so this follows the plan. If JSONB is wanted for indexing or querying, it is a one-line `JSON().with_variant(JSONB, "postgresql")` change (protected file, so it is a decision for the controller).
- G2: spec §6 `allocation_runs.params` has no column. Scoring weights are not configurable per run through the API; only `algorithm` is stored. The plan did not include it.
- G3: spec §8 "LLM failure -> fallback flagged": the API has no test where an LLM client is configured but raises. Only the no-key path is tested at the API level, and the raising path is tested in core. Optional test: monkeypatch `api.services.profiles.get_llm_client` to a raising fake and assert 201 with `used_fallback == true`.
- G4: spec §3 lists a Redis "score-matrix cache" and "FastAPI (async)". M2 implements the embedding cache only and uses sync endpoints, as the plan's Global Constraints direct.
- G5: opportunities do not store `used_fallback` from `parse_posting`. The spec only requires the flag on the profile.

Result: PASS (spec §6-9 milestone-2 scope covered; gaps G1-G5 are plan-sanctioned or optional).

## Check 7: hygiene

- No TODO/FIXME/XXX/breakpoint/pdb in `api/`, `migrations/` or `tests/api/`. The only `print(` calls are the intended CLI output in `api/cli.py:43,45` (stderr error, admin id).
- No hard-coded secrets in `api/`. `JWT_SECRET` has no default (`config.py:12 jwt_secret: str`, and a missing value raises `RuntimeError("JWT_SECRET is required")`). `test-secret` exists only in the tests conftest, and `fairmatch/fairmatch` only in docker-compose.dev.yml (dev).
- `git status --short`: only the expected Task 7 files plus the judge/task report files under docs/. No `.db` or sqlite files currently in the tree, and none tracked (`git ls-files` clean of *.db/.env/caches).
- **B2 (blocking, hygiene): `.gitignore` (repo root, the only one) does not cover `*.db`, sqlite files or `.env`.** It lists `__pycache__/ .pytest_cache/ .superpowers/ .venv/ *.pyc`. `.ruff_cache` is ignored only through ruff's own `.ruff_cache/.gitignore`.
  - `git check-ignore` confirms `fairmatch/fairmatch.db`, `fairmatch/.env` and `fairmatch/x.sqlite3` are NOT ignored.
  - The default `DATABASE_URL=sqlite:///./fairmatch.db` creates `fairmatch/fairmatch.db` on the first `alembic upgrade head` or app run, which is exactly the B1 path, so `git add .` would commit it.
  - Fix: add `*.db`, `*.sqlite`, `*.sqlite3`, `.env`, `.env.*` and `.ruff_cache/` to `.gitignore`.
- **B3 (blocking, security): an empty `JWT_SECRET` is accepted.** `JWT_SECRET="" python -c "from api.config import get_settings; ..."` gives `jwt_secret == ''`, and `create_access_token(1, "admin")` then signs a token that `decode_access_token` accepts. Anyone could forge an admin token with HMAC key `""`.
  - This defeats the Global Constraint "`JWT_SECRET` has no default; the app refuses to start without it". It is a realistic misconfiguration: `export JWT_SECRET=`, or docker compose `${JWT_SECRET}` with the variable unset, both yield `""`.
  - Fix in `fairmatch/api/config.py:12` (not on the protected list): `jwt_secret: str = Field(min_length=1)` plus a `field_validator` rejecting whitespace-only values. The existing `get_settings` already maps any `("jwt_secret",)` validation error to `RuntimeError("JWT_SECRET is required")`.
  - Add `test_blank_jwt_secret_refuses_to_start` in tests/api/test_app.py (`monkeypatch.setenv("JWT_SECRET", "")` and `"   "` -> `pytest.raises(RuntimeError)`).

Result: FIX NEEDED (B2, B3).

## Verdict

**VERDICT: PASS_WITH_FIXES**

The Task 7 code itself (search.py, schemas, main.py include, both new test files) is correct, and I found no blocking defect in it. The SQLite and PostgreSQL branches both behave as the plan requires. The three blocking items are small and outside the search logic.

### Blocking issues (3)

1. **B1: fairmatch/README.md:53-60, Setup cannot be followed as written.**
   - `alembic upgrade head` fails with `RuntimeError: JWT_SECRET is required` (migrations/env.py calls `get_settings()`).
   - Without `DATABASE_URL`, everything uses `sqlite:///./fairmatch.db` instead of the Postgres started one line earlier.
   - Fix: insert `export JWT_SECRET=<long random string>` and `export DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch` before `alembic upgrade head`, with a note that both are needed in the API and worker terminals.
2. **B2: .gitignore (repo root) misses `*.db`, sqlite files and `.env`.**
   - The default DB URL writes `fairmatch/fairmatch.db` into the tree, and `git check-ignore` confirms it is not ignored.
   - Fix: append `*.db`, `*.sqlite`, `*.sqlite3`, `.env`, `.env.*`, `.ruff_cache/`.
3. **B3: fairmatch/api/config.py:12 accepts `JWT_SECRET=""`.**
   - Tokens are then signed and verified with an empty HMAC key, so admin tokens are forgeable. This contradicts "the app refuses to start without it".
   - Fix: `jwt_secret: str = Field(min_length=1)` plus a validator rejecting blank or whitespace values (`get_settings` already converts `jwt_secret` errors to `RuntimeError("JWT_SECRET is required")`).
   - Add a test in tests/api/test_app.py for `""` and `"   "`.

### Non-blocking notes

- N1: README.md:81-82, `POST /candidates` and `GET /candidates/me`:
  - the role is "candidate or admin" (candidates.py:35);
  - the `POST /candidates` errors should be `400, 401, 409, 422`: 403 cannot occur, 413 is never emitted, and a >1 MiB `resume_text` form field gives Starlette's 400.
- N2: on Windows, the Celery worker needs `--pool=solo`; mention it in the README.
- N3: unhandled exceptions return Starlette's plain-text 500, not `{"detail": str}`.
- N4: env table: document the defaults `ACCESS_TOKEN_MINUTES=60` and `REDIS_URL=redis://localhost:6379/0`, and the `fakeredis://` option.
- N5: test_search_pg / test_migrations_pg:
  - a bare `postgresql://` TEST_DATABASE_URL fails because psycopg2 is not installed (the README form is correct);
  - test_migrations_pg.py downgrades only on success and should downgrade in `finally`.
- N6: search ties use the 6-decimal rounded value. At the exact `limit` boundary, PG (SQL LIMIT on the exact distance) and SQLite (cut after rounding) could pick different candidates when their similarities agree to 6 decimals.
- N7: `_cosine` returns 0.0 for vectors whose squared norm underflows or overflows (1e-200 or 1e200 entries). Embeddings are L2-normalised and validated finite, so real data never gets near this.
- N8: the PG ORDER BY id tie-break and HNSW approximation mean large-table PG results may not exactly equal the exact Python ranking. Small and test data are exact.
- N9: spec gaps G1-G5 (JSON instead of JSONB, no `allocation_runs.params`, no API-level raising-LLM test, no score-matrix cache or async endpoints, no posting `used_fallback`). All are plan-sanctioned or optional.

### Spec-coverage statement

For milestone 2, spec §6 data model is fully represented:
- `users`, `candidates` (with a 384-d pgvector embedding and demographics isolated in `candidate_demographics`), `opportunities`, `allocation_runs`, `allocations`;
- HNSW cosine indexes, verified offline via `alembic upgrade head --sql`;
- deviations: JSON rather than JSONB, and no `params` column.

Every §7 endpoint is implemented and tested:
- `POST /auth/login`, `POST /candidates` with text or .pdf/.docx/.txt upload, `POST /opportunities`;
- `POST /runs` returning 202 with the run id;
- `GET /runs/{id}` with status, allocations, fairness and per-algorithm comparison metrics;
- `GET /runs/{id}/explanations`;
- plus the plan's similarity search.

All four §8 error-handling rules have code and tests:
- unparseable resume -> 422 with a reason, nothing persisted;
- LLM failure -> spaCy fallback recorded as `used_fallback` (raising-LLM path tested in core; the API test covers the no-key path only);
- run failure -> `failed` with a message;
- zero candidates, opportunities or seats rejected up front with no run row.

§9's "API tests with a test Postgres container" exists as `@pytest.mark.db` tests that skip cleanly here (accepted limitation: Docker off). They were reviewed as correct for a real psycopg3 + pgvector run. CI belongs to milestone 4.
