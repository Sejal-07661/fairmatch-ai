# FairMatch AI Milestone 2: Database and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the committed `fairmatch/core` pipeline behind a secured FastAPI service with PostgreSQL + pgvector persistence, Celery background runs, and a Redis embedding cache.

**Architecture:** A new `fairmatch/api/` package is a thin layer over `core`: routers validate and persist, a Celery task loads data, calls `core.pipeline.run_pipeline`, and stores allocations, fairness and explanations. `core` is not modified. Business logic lives in `api/services/`, routers only translate HTTP.

**Tech Stack:** FastAPI, Pydantic v2 + pydantic-settings, SQLAlchemy 2.x (sync) + Alembic, psycopg 3, pgvector, Celery + Redis, bcrypt, python-jose (JWT), python-multipart, pytest, fakeredis, httpx.

**Spec:** `docs/superpowers/specs/2026-11-02-fairmatch-design.md` (sections 2, 3, 4, 6, 7, 8, 9). Milestone 1 plan: `docs/superpowers/plans/2026-11-03-milestone-1-core-upgrade.md` (done; `core` interfaces are committed and are the source of truth).

## Global Constraints

- Only mainstream libraries; no dependency beyond the Tech Stack line.
- `core/` is not modified. Anything missing in `core` is reported, not patched.
- Protected attributes live only in table `candidate_demographics`. They are never read by scoring or allocation, never returned to a candidate-role user, and only admins can write or read them. They reach `core` only as `group_of` for `fairness.audit`.
- `group_of` passed to `run_pipeline` is keyed by the generated ids `c1..cN` in input order; the run service owns the mapping from `cN` back to database candidate ids.
- LLMs never decide allocation. Without `OPENAI_API_KEY` every path falls back and records `used_fallback`.
- Roles are exactly `candidate` and `admin`. JWT HS256, access token only, lifetime `ACCESS_TOKEN_MINUTES` (default 60). `JWT_SECRET` has no default; the app refuses to start without it.
- Embedding dimension is 384 (`BAAI/bge-small-en-v1.5`). Settings come from env: `DATABASE_URL` (default `sqlite:///./fairmatch.db`), `REDIS_URL` (default `redis://localhost:6379/0`), `CELERY_EAGER` (default false), `OPENAI_API_KEY`, `OPENAI_MODEL`.
- Sync SQLAlchemy sessions throughout (endpoints are plain `def`, FastAPI runs them in its threadpool; the Celery worker shares the same session factory). No async/sync mixing.
- Unit tests run with no external services: SQLite in memory, `fakeredis`, Celery eager mode, `fake_embedder`, `llm=None`. Tests that need real PostgreSQL carry `@pytest.mark.db` and skip unless `TEST_DATABASE_URL` is set.
- The autouse fixture that removes `OPENAI_API_KEY` for non-`llm` tests stays in force.
- All commands run from `fairmatch/`; code in `fairmatch/api/`, tests in `fairmatch/tests/api/`.
- Error shape: every non-2xx response is `{"detail": str}`; validation failures use 422.

## Review Focus

- Candidate role reads or writes another user's candidate profile, or reads any demographics: must be 403/404, never data.
- Resume upload that is empty, wrong type, or not parseable: 422 with a reason, nothing persisted.
- Run requested with zero candidates, zero opportunities, or total seats 0: 422 up front, no run row created.
- Run whose pipeline raises: run ends `failed` with a message, other runs and the API stay healthy.
- Two runs submitted at once, or a run re-delivered by Celery: no duplicate allocations (task is idempotent per run id).
- Expired, malformed or wrong-secret JWT; login with unknown email: 401 with the same message for unknown email and wrong password.
- Demographics present for only some candidates: fairness is skipped and the run records that fact, rather than crashing or mislabelling.

---

### Task 1: API scaffolding and settings

**Files:**
- Create: `fairmatch/api/__init__.py`, `fairmatch/api/config.py`, `fairmatch/api/main.py`, `fairmatch/tests/api/__init__.py`, `fairmatch/tests/api/conftest.py`, `fairmatch/tests/api/test_app.py`
- Modify: `fairmatch/requirements.txt`, `fairmatch/pyproject.toml` (register markers `db`; add `asyncio_mode` not needed)

**Interfaces:**
- Produces: `class Settings(BaseSettings)` with fields `database_url: str`, `redis_url: str`, `jwt_secret: str`, `jwt_algorithm: str = "HS256"`, `access_token_minutes: int = 60`, `celery_eager: bool = False`; `get_settings() -> Settings` (lru_cached; raises `RuntimeError("JWT_SECRET is required")` when unset); `create_app() -> FastAPI` with `GET /health` returning `{"status": "ok"}`.
- Produces test fixtures in `tests/api/conftest.py`: `settings_env` (autouse; sets `JWT_SECRET="test-secret"`, `DATABASE_URL="sqlite://"`, `CELERY_EAGER="true"`, clears the settings cache), `client` (`fastapi.testclient.TestClient(create_app())`).

- [ ] **Step 1: Add dependencies** to `requirements.txt`: `fastapi`, `uvicorn`, `pydantic-settings`, `sqlalchemy`, `alembic`, `psycopg[binary]`, `pgvector`, `celery`, `redis`, `fakeredis`, `bcrypt`, `python-jose`, `python-multipart`, `httpx`; run `pip install -r requirements.txt`.
- [ ] **Step 2: Write failing tests:** `test_health_ok` (200, `{"status": "ok"}`); `test_missing_jwt_secret_refuses_to_start` (monkeypatch removes `JWT_SECRET`, clear cache, `pytest.raises(RuntimeError)` on `get_settings()`); `test_settings_defaults` (`access_token_minutes == 60`).
- [ ] **Step 3: Run** `pytest tests/api/test_app.py -v`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `config.py` and `main.py`; register the `db` marker in `pyproject.toml`.
- [ ] **Step 5: Run** `pytest tests/api/test_app.py -v` and `ruff check .`. Expected: PASS, clean.
- [ ] **Step 6: Commit** `feat(api): scaffold FastAPI app and settings`.

### Task 2: Database models, session and migrations

**Files:**
- Create: `fairmatch/api/db.py`, `fairmatch/api/vector.py`, `fairmatch/api/models.py`, `fairmatch/alembic.ini`, `fairmatch/migrations/env.py`, `fairmatch/migrations/versions/0001_initial.py`, `fairmatch/docker-compose.dev.yml`, `fairmatch/tests/api/test_models.py`, `fairmatch/tests/api/test_migrations_pg.py`

**Interfaces:**
- Produces in `db.py`: `class Base(DeclarativeBase)`; `get_engine() -> Engine` (cached, SQLite uses `StaticPool` and `check_same_thread=False` when `DATABASE_URL` is `sqlite://`); `SessionLocal() -> Session` factory; `get_session() -> Iterator[Session]` FastAPI dependency (commit on success, rollback on error); `reset_engine_cache() -> None` for tests.
- Produces in `vector.py`: `class EmbeddingType(TypeDecorator)` storing a `list[float]` of length 384: pgvector `Vector(384)` on PostgreSQL, JSON elsewhere.
- Produces in `models.py` (SQLAlchemy 2 `Mapped`, all with integer `id` primary keys):
  - `User(email unique, password_hash, role, created_at)`
  - `Candidate(user_id FK unique, name, resume_text, skills: list[str] JSON, experience_years, education_level, used_fallback: bool, embedding: EmbeddingType nullable)`
  - `CandidateDemographics(candidate_id FK primary key, group_label: str)`
  - `Opportunity(title, posting_text, required_skills JSON, capacity, min_experience_years, min_education_level, embedding nullable)`
  - `AllocationRun(requested_by FK, algorithm: str in {"hungarian","gale_shapley","both"}, status: str in {"pending","running","done","failed"}, error nullable, metrics JSON nullable, fairness JSON nullable, created_at, finished_at nullable)`
  - `Allocation(run_id FK, algorithm: str, candidate_id FK, opportunity_id FK, score: float, breakdown JSON, reasons JSON, narrative: str, used_fallback: bool)`; unique constraint `(run_id, algorithm, candidate_id)`.
- Migration `0001_initial` creates all tables; on PostgreSQL only it runs `CREATE EXTENSION IF NOT EXISTS vector` first and creates HNSW indexes (`vector_cosine_ops`) on both `embedding` columns.
- `docker-compose.dev.yml`: services `postgres` (image `pgvector/pgvector:pg16`, port 5432, db/user/password `fairmatch`) and `redis` (image `redis:7`, port 6379).

- [ ] **Step 1: Write failing tests (SQLite):** `test_create_all_and_roundtrip` (insert User, Candidate with a 384-float embedding, Opportunity, AllocationRun, Allocation; read back equal); `test_allocation_unique_per_run_algorithm_candidate` (duplicate raises `IntegrityError`); `test_email_unique`; `test_embedding_none_allowed`; `test_session_rolls_back_on_error`.
- [ ] **Step 2: Write the Postgres test** `@pytest.mark.db test_migration_upgrade_head_creates_hnsw_indexes`: run `alembic upgrade head` against `TEST_DATABASE_URL`, assert the `vector` extension exists and both indexes exist in `pg_indexes`; then `alembic downgrade base` leaves no tables.
- [ ] **Step 3: Run** `pytest tests/api/test_models.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement** the modules, Alembic env (reads `DATABASE_URL` from settings), and the migration by hand (not autogenerate output pasted blindly; verify column parity with `models.py`).
- [ ] **Step 5: Run** `pytest tests/api/test_models.py -v`. Expected: PASS. If `TEST_DATABASE_URL` is set (start `docker compose -f docker-compose.dev.yml up -d`), also run `pytest -m db -v`. Expected: PASS; otherwise the db test shows SKIPPED.
- [ ] **Step 6: Commit** `feat(api): SQLAlchemy models, pgvector type, Alembic migration`.

### Task 3: Authentication and roles

**Files:**
- Create: `fairmatch/api/security.py`, `fairmatch/api/schemas.py`, `fairmatch/api/deps.py`, `fairmatch/api/routers/__init__.py`, `fairmatch/api/routers/auth.py`, `fairmatch/api/cli.py`, `fairmatch/tests/api/test_auth.py`
- Modify: `fairmatch/api/main.py` (include router)

**Interfaces:**
- Consumes: `User`, `get_session`, `Settings`.
- Produces in `security.py`: `hash_password(plain: str) -> str` (bcrypt); `verify_password(plain: str, hashed: str) -> bool`; `create_access_token(user_id: int, role: str) -> str`; `decode_access_token(token: str) -> dict` (claims `sub` as str user id, `role`, `exp`; raises `ValueError` on any invalid or expired token).
- Produces in `deps.py`: `get_current_user(token=Depends(oauth2_scheme), session=Depends(get_session)) -> User` (401 on bad token or missing user); `require_role(*roles: str) -> Callable` dependency (403 when role not allowed).
- Produces endpoints: `POST /auth/register` (body `{email, password}`, password min length 8, creates role `candidate`, 201 `{id, email, role}`, 409 duplicate email); `POST /auth/login` (form fields `username`, `password`; 200 `{access_token, token_type: "bearer"}`; 401 `{"detail": "Invalid credentials"}` for both unknown email and wrong password).
- Produces `python -m api.cli create-admin EMAIL PASSWORD` (creates or promotes an admin; prints the id).
- Schemas in `schemas.py`: `UserOut`, `TokenOut`, `RegisterIn`.

- [ ] **Step 1: Write failing tests:** `test_register_then_login_returns_token`; `test_register_duplicate_email_409`; `test_short_password_422`; `test_login_unknown_email_and_wrong_password_same_401_message`; `test_expired_token_401` (token created with a past `exp` via monkeypatched settings); `test_wrong_secret_token_401`; `test_malformed_token_401`; `test_candidate_cannot_use_admin_dependency_403` (a tiny test-only route guarded by `require_role("admin")`); `test_cli_create_admin_creates_admin_user`; `test_password_hash_not_plaintext_and_verifies`.
- [ ] **Step 2: Run** `pytest tests/api/test_auth.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** security, deps, router and CLI; the shared session fixture creates tables on the in-memory engine per test.
- [ ] **Step 4: Run** `pytest tests/api/test_auth.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): JWT auth with candidate and admin roles`.

### Task 4: Embedding cache and Celery app

**Files:**
- Create: `fairmatch/api/services/__init__.py`, `fairmatch/api/services/embedding.py`, `fairmatch/api/worker.py`, `fairmatch/tests/api/test_embedding_cache.py`, `fairmatch/tests/api/test_worker_config.py`

**Interfaces:**
- Consumes: `core.embeddings.Embedder`, `SentenceTransformerEmbedder`; `Settings`.
- Produces in `embedding.py`: `class CachedEmbedder` implementing `Embedder` (`encode(texts: list[str]) -> np.ndarray`, L2-normalised rows) wrapping an inner `Embedder` and a Redis client; cache key `emb:{model}:{sha256(text)}`, value is raw float32 bytes; one `mget` and one `pipeline` write per call; Redis errors are swallowed (logged) and fall back to the inner embedder so the API never fails because Redis is down. `get_redis() -> redis.Redis` (uses `fakeredis.FakeRedis` when `REDIS_URL` starts with `fakeredis://`). `get_embedder() -> Embedder` returns `CachedEmbedder(SentenceTransformerEmbedder(), get_redis())`; tests monkeypatch this function.
- Produces in `worker.py`: `celery_app` configured from `Settings` (`broker_url`/`result_backend` = `redis_url`, `task_always_eager = settings.celery_eager`, `task_eager_propagates = True`, JSON serializer only).

- [ ] **Step 1: Write failing tests:** `test_second_encode_hits_cache` (counting inner embedder called once for repeated text); `test_partial_hit_encodes_only_misses`; `test_redis_down_falls_back_to_inner` (client whose `mget` raises `redis.ConnectionError`); `test_empty_list_returns_zero_rows_without_calls`; `test_cached_vectors_equal_fresh_vectors`; `test_celery_eager_flag_follows_settings`.
- [ ] **Step 2: Run** `pytest tests/api/test_embedding_cache.py tests/api/test_worker_config.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Redis embedding cache and Celery app`.

### Task 5: Candidates and opportunities endpoints

**Files:**
- Create: `fairmatch/api/routers/candidates.py`, `fairmatch/api/routers/opportunities.py`, `fairmatch/api/services/profiles.py`, `fairmatch/tests/api/test_candidates.py`, `fairmatch/tests/api/test_opportunities.py`
- Modify: `fairmatch/api/schemas.py`, `fairmatch/api/main.py`, `fairmatch/api/worker.py` (add task)

**Interfaces:**
- Consumes: `get_current_user`, `require_role`, `core.parser.parse_candidate`, `parse_posting`, `read_resume_file`, `core.llm.get_llm_client`, `get_embedder`.
- Produces in `services/profiles.py`: `create_candidate_profile(session, user, name, text) -> Candidate` (parses with `parse_candidate(id=..., name, text, llm=get_llm_client())`, persists skills, experience, education, `used_fallback`; raises `ValueError` when `text.strip()` is empty); `create_opportunity(session, payload) -> Opportunity`.
- Produces a Celery task `embed_profile(kind: str, row_id: int) -> None` in `worker.py` (`kind` is `"candidate"` or `"opportunity"`; encodes the stored text with `get_embedder()` and stores the 384-float vector; idempotent; no-op when the row no longer exists). It is enqueued after commit with `.delay(...)`.
- Endpoints:
  - `POST /candidates` (role candidate or admin): multipart with `name` and either `resume_text` or file `resume` (`.pdf`, `.docx`, `.txt`, max 5 MiB); one profile per user (409 on a second); 201 `CandidateOut`; empty text, unsupported type or unparseable file gives 422 with a reason and persists nothing.
  - `GET /candidates/me` (candidate), `GET /candidates` and `GET /candidates/{id}` (admin only).
  - `PUT /candidates/{id}/demographics` (admin only, body `{group_label: str}` non-empty, max 64 chars) and `GET /candidates/{id}/demographics` (admin only). `CandidateOut` never contains a demographics field.
  - `POST /opportunities` (admin; body `title, posting_text, capacity >= 1, min_experience_years >= 0, min_education_level 0..4`), `GET /opportunities`, `GET /opportunities/{id}` (any authenticated user).
- Schemas: `CandidateOut(id, name, skills, experience_years, education_level, used_fallback)`, `OpportunityIn`, `OpportunityOut`, `DemographicsIn`, `DemographicsOut`.

- [ ] **Step 1: Write failing tests (candidates):** `test_candidate_creates_profile_from_text` (skills extracted, `used_fallback` true without key); `test_second_profile_409`; `test_upload_txt_file`; `test_upload_pdf_and_docx` (tiny real files generated in the test with PyMuPDF/python-docx); `test_unsupported_suffix_422_nothing_persisted`; `test_empty_text_422`; `test_oversized_file_422`; `test_candidate_cannot_list_candidates_403`; `test_candidate_cannot_read_demographics_403`; `test_admin_sets_and_reads_demographics`; `test_candidate_out_has_no_demographics_field`; `test_get_me_without_profile_404`; `test_embed_profile_task_stores_vector_and_is_idempotent` (eager Celery, `fake_embedder` monkeypatched into `get_embedder`).
- [ ] **Step 2: Write failing tests (opportunities):** `test_admin_creates_opportunity`; `test_candidate_cannot_create_403`; `test_capacity_zero_422`; `test_education_level_out_of_range_422`; `test_any_authenticated_user_can_list`; `test_unauthenticated_401`.
- [ ] **Step 3: Run** `pytest tests/api/test_candidates.py tests/api/test_opportunities.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement** the services, task, routers and schemas.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): candidate and opportunity endpoints with embedding task`.

### Task 6: Allocation runs

**Files:**
- Create: `fairmatch/api/services/runs.py`, `fairmatch/api/routers/runs.py`, `fairmatch/tests/api/test_runs.py`
- Modify: `fairmatch/api/schemas.py`, `fairmatch/api/main.py`, `fairmatch/api/worker.py` (add task)

**Interfaces:**
- Consumes: `core.pipeline.run_pipeline(candidates_in, postings_in, group_of=None, embedder=None, llm=None, weights=None) -> PipelineResult`; models; `get_embedder`; `get_llm_client`.
- Produces in `services/runs.py`:
  - `validate_run_preconditions(session) -> None` raising `ValueError` with a specific message when there are 0 candidates, 0 opportunities, or total seats is 0.
  - `create_run(session, user, algorithm: str) -> AllocationRun` (status `pending`; `algorithm` must be one of `hungarian|gale_shapley|both`).
  - `execute_run(session, run_id: int) -> None`: loads candidates and opportunities ordered by id, builds the dict inputs `run_pipeline` expects (`name`, `resume_text`; `title`, `posting_text`, `capacity`), builds `group_of` keyed `c1..cN` only if EVERY candidate has demographics (otherwise `group_of=None` and `metrics["fairness_skipped"]="demographics missing for k of n candidates"`), calls `run_pipeline`, maps generated ids back to database ids, persists `Allocation` rows only for the requested algorithm(s), stores `metrics` (per algorithm: `total_score`, `blocking_pairs`, `runtime_ms`, `unallocated` as database candidate ids) and `fairness` (per algorithm report as plain JSON), sets `status="done"` and `finished_at`. Idempotent: if the run is already `done`, return without writing; before writing, delete any existing `Allocation` rows of that run. Any exception sets `status="failed"` with `error=str(exc)[:500]` and does not re-raise.
- Produces Celery task `run_allocation(run_id: int) -> None` in `worker.py` calling `execute_run` with its own session.
- Endpoints (admin only): `POST /runs` body `{algorithm: "hungarian"|"gale_shapley"|"both"}` runs preconditions (422 with the message, no row created), creates the run, enqueues `run_allocation.delay(run.id)`, returns 202 `{id, status}`; `GET /runs` list; `GET /runs/{id}` returns `RunOut` (`id, algorithm, status, error, metrics, fairness, created_at, finished_at, allocations: list[AllocationOut]`); `GET /runs/{id}/explanations` returns `list[ExplanationOut]` (`algorithm, candidate_id, opportunity_id, score, reasons, narrative, used_fallback`); 404 for unknown run.
- A run in status `pending` or `running` returns `allocations: []`.

- [ ] **Step 1: Write failing tests (fake embedder monkeypatched, `llm=None`, eager Celery):** `test_run_both_algorithms_persists_allocations_and_metrics` (3 candidates, 2 opportunities, capacity respected, `metrics` has both algorithm keys, status `done`); `test_run_single_algorithm_persists_only_that_one`; `test_zero_candidates_422_no_run_row`; `test_zero_opportunities_422`; `test_total_seats_zero_422` (capacity cannot be 0 via API, so set it directly in the DB for the test); `test_pipeline_exception_marks_run_failed_with_message` (monkeypatch `run_pipeline` to raise); `test_rerun_of_done_run_is_noop_and_no_duplicates`; `test_rerun_of_failed_run_replaces_partial_rows`; `test_fairness_computed_when_all_have_demographics`; `test_fairness_skipped_when_some_missing_and_recorded`; `test_candidate_role_cannot_start_or_read_runs_403`; `test_unknown_run_404`; `test_explanations_endpoint_returns_reasons_without_resume_text`; `test_allocation_ids_map_back_to_database_ids` (non-contiguous db ids, e.g. after deleting a row).
- [ ] **Step 2: Run** `pytest tests/api/test_runs.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, task, router and schemas.
- [ ] **Step 4: Run** `pytest tests/api/test_runs.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): allocation runs via Celery with fairness and explanations`.

### Task 7: Similarity search, end-to-end test and docs

**Files:**
- Create: `fairmatch/api/routers/search.py`, `fairmatch/tests/api/test_end_to_end.py`, `fairmatch/tests/api/test_search_pg.py`
- Modify: `fairmatch/api/main.py`, `fairmatch/README.md`, `fairmatch/pyproject.toml` (ruff settings for `api/` if needed)

**Interfaces:**
- Consumes: models with `embedding`, `get_embedder`.
- Produces: `GET /opportunities/{id}/similar-candidates?limit=10` (admin only; default limit 10, range 1..50): on PostgreSQL uses pgvector cosine distance (`Candidate.embedding.cosine_distance(...)`) ordered ascending; on other databases computes cosine in Python over stored vectors; response `list[{candidate_id, similarity: float}]` sorted by similarity descending; candidates or opportunity without an embedding yield an empty list (not an error); unknown opportunity 404.
- Produces a full-flow test and README sections: setup (`pip install`, `docker compose -f docker-compose.dev.yml up -d`, `alembic upgrade head`, `python -m api.cli create-admin`, `uvicorn api.main:create_app --factory`, `celery -A api.worker.celery_app worker`), endpoint table, role/privacy rules, env vars.

- [ ] **Step 1: Write failing tests:** `test_similar_candidates_sorted_by_similarity` (SQLite path, fake embedder, embeddings stored by the eager task); `test_similar_no_embeddings_returns_empty`; `test_similar_unknown_opportunity_404`; `test_similar_limit_validation_422`; `test_similar_requires_admin_403`; and `test_end_to_end_flow`: admin created via CLI function, two candidate users register and create profiles, admin adds two opportunities and demographics for both candidates, `POST /runs` with `both`, `GET /runs/{id}` shows `done`, allocations within capacity, fairness present, explanations present, and a candidate token gets 403 on `/runs/{id}`.
- [ ] **Step 2: Write the Postgres test** `@pytest.mark.db test_pgvector_similarity_matches_python_cosine`: same data on PostgreSQL, order and values within 1e-5 of the Python computation.
- [ ] **Step 3: Run** `pytest tests/api/test_end_to_end.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement** the search router; write the README sections.
- [ ] **Step 5: Run** the full suite `pytest -m "not slow and not llm and not db" -q` and `ruff check .`. Expected: all pass, clean. With `TEST_DATABASE_URL` set also `pytest -m db -v`; expected PASS (otherwise SKIPPED).
- [ ] **Step 6: Run** `python demo.py` to confirm Milestone 1 is unaffected. Expected: exit 0.
- [ ] **Step 7: Commit** `feat(api): similarity search, end-to-end test, API docs`.
