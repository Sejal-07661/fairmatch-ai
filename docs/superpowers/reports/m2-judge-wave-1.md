# M2 Judge, Wave 1 (Task 2: DB/models/migration, Task 4: embedding cache/Celery)

Judge date: 2026-11-03. Read-only review of the uncommitted working tree on `master` (HEAD 5671fb4).
Authority: plan `docs/superpowers/plans/2026-11-03-milestone-2-database-and-api.md`, spec
`docs/superpowers/specs/2026-11-02-fairmatch-design.md`. Docker unavailable, so no live PostgreSQL;
PG behaviour checked via Alembic offline SQL and dialect compilation. Scratch scripts live in
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\`.

VERDICT: PASS_WITH_FIXES. 7 blocking issues (M1-M7), 20 non-blocking notes (N1-N20). See "Verdict" at the end.

## Check 1: suite, lint, untouched files

| Item | Result |
|---|---|
| `python -m pytest -m "not slow and not llm and not db" -q` | 136 passed, 3 deselected (17.9 s) |
| `python -m ruff check .` | All checks passed |
| `git diff HEAD --stat -- core` | empty; `git status --porcelain -- core` also empty |
| `requirements.txt`, `pyproject.toml` vs HEAD | unchanged (empty diff, not in status) |
| `pytest tests/api -rs -v` | 18 passed, 1 skipped |
| db test skip reason | `SKIPPED [1] tests\api\test_migrations_pg.py:14: set TEST_DATABASE_URL (start Postgres with `docker compose -f docker-compose.dev.yml up -d`)` (helpful) |
| `pytest -m db -rs` | 1 skipped, same reason |

Result: PASS.

## Check 2: interfaces vs plan (Tasks 2 and 4)

Evidence: `scratchpad/c2_interfaces.py` (introspects signatures and every column), `scratchpad/c2_comparator.py`,
`scratchpad/c6_sim.py`.

### Matches

- `Settings` (api/config.py:7-15, Task 1, unchanged): `database_url`, `redis_url`, `jwt_secret` (no default),
  `jwt_algorithm="HS256"`, `access_token_minutes=60`, `celery_eager=False`. Defaults match Global Constraints.
- `api/db.py`: `Base(DeclarativeBase)`; `get_engine() -> Engine` lru_cached, StaticPool +
  `check_same_thread=False` for `sqlite://` and `sqlite:///:memory:`; `SessionLocal() -> Session`;
  `get_session() -> Iterator[Session]` (commit / rollback / close); `reset_engine_cache() -> None`
  (disposes then clears). All five match.
- `api/vector.py`: `EmbeddingType(TypeDecorator)`, `Vector(384)` on postgresql, JSON elsewhere.
- Models: integer `id` PKs everywhere except `candidate_demographics` (PK = FK `candidate_id`, as pinned).
  `users.email` unique; `candidates.user_id` FK users.id + unique; FKs `allocation_runs.requested_by -> users`,
  `allocations.run_id -> allocation_runs`, `.candidate_id -> candidates`, `.opportunity_id -> opportunities`;
  `UniqueConstraint(run_id, algorithm, candidate_id, name="uq_allocation_run_algo_cand")`.
  Nullability: only `embedding` (x2), `error`, `metrics`, `fairness`, `finished_at` nullable, as pinned.
- `api/services/embedding.py`: `CachedEmbedder(inner, client, model=None)` with
  `encode(texts: list[str]) -> np.ndarray`; key `emb:{model}:{sha256}`; float32 bytes; `get_redis() -> redis.Redis`
  (FakeRedis for `fakeredis://`); `get_embedder() -> Embedder` returning
  `CachedEmbedder(SentenceTransformerEmbedder(), get_redis())`. All match.
- `api/worker.py`: broker/backend = `redis_url`, `task_always_eager = celery_eager`, `task_eager_propagates=True`,
  JSON-only serializers. Config values match.

### MISMATCHES

M1 (BLOCKING, Tasks 5/6/7). `education_level` / `min_education_level` are `String(50)`
(api/models.py:33, api/models.py:54, migrations/versions/0001_initial.py:38 and :55; tests use
`"bachelor"`/`"none"` at tests/api/test_models.py:28,31,55,57,87,89). The source of truth is integer:
`core.models.Candidate.education_level: int`, `Posting.min_education_level: int` (core/models.py:11,23),
`core.parser._regex_education -> int` 0..4 (core/parser.py:50-57), and the plan's Task 5 pins
`min_education_level 0..4` plus `test_education_level_out_of_range_422`. Storing core's int in a VARCHAR
returns `'2'` (a str) on SQLite (see Check 4), so `CandidateOut.education_level` and any ordering/comparison
would silently change type. Fix: `Mapped[int]` (Integer) for both columns in models.py and the migration;
use ints (e.g. `2`, `0`) in test_models.py.

M2 (BLOCKING, Task 7). `Candidate.embedding.cosine_distance(...)` (pinned in Task 7) raises
`AttributeError: Neither 'InstrumentedAttribute' object nor 'Comparator' object associated with
Candidate.embedding has an attribute 'cosine_distance'`. Cause: api/vector.py:11 `impl = JSON`, so the
column's comparator is JSON's, not pgvector's (the comparator is chosen at expression-build time, not per
dialect). Fix: `impl = Vector(EMBEDDING_DIM)` while keeping `load_dialect_impl` returning `JSON()` for
non-postgresql; verified in scratch that this compiles to `ORDER BY t.e <=> %(e_1)s` on PostgreSQL.
(Alternative: give EmbeddingType a `comparator_factory` subclass with `cosine_distance`/`l2_distance`.)

M3 (BLOCKING, Tasks 5/6). `celery_app` is not a real module attribute (api/worker.py:8-25:
`get_celery_app()` lru_cached plus PEP 562 `__getattr__`). Tasks 5 and 6 must "add task" in worker.py;
simulated in `scratchpad/c6_sim.py`:
  - `@celery_app.task` inside worker.py -> `NameError: name 'celery_app' is not defined` (module `__getattr__`
    is not consulted for in-module global lookups);
  - `@get_celery_app().task` -> `RuntimeError: JWT_SECRET is required` at import, which would break
    `tests/api/conftest.py` collection once `api.main` imports a router that imports the task;
  - even with a secret present, a task binds to the app built at import time: after
    `get_celery_app.cache_clear()` the task stays on the old app (`task_always_eager=False`), so
    "eager follows settings" is lost for tasks.
  Fix (verified in `scratchpad/sim/worker_fix2.py` / `c6_fix2.py`): module-level
  `celery_app = Celery("fairmatch")` with the JSON/propagate options set at import (no settings access),
  plus `configure_celery() -> Celery` that applies `broker_url`, `result_backend`, `task_always_eager` from
  `get_settings()` to that same instance (idempotent). Call it from `create_app()`, from the `settings_env`
  fixture after `get_settings.cache_clear()`, and at worker start-up. `@celery_app.task` then works,
  imports need no JWT_SECRET, `.delay()` runs eagerly in tests, and `find_app("api.worker.celery_app")`
  still resolves. Keep `get_celery_app()` as a thin alias returning `configure_celery()` if desired.

### Non-blocking interface notes

- N1 `experience_years`/`min_experience_years` are Float (models.py:32,53) while core uses `int`. Float is a
  superset, so it is acceptable, but Task 5 schemas must declare them `float` or round-trip `3` -> `3.0`.
- N2 `algorithm`, `status`, `role` have no CHECK constraint (plan says "str in {...}"); enforcement will
  have to live in services/schemas (Tasks 3/6). Consider `CheckConstraint` in both models and migration.
- N3 Spec section 6 says JSONB for `skills`/`breakdown`; implementation uses generic `sa.JSON` (PG `JSON`).
  Plan text says "JSON", so not a mismatch with the plan; `JSON().with_variant(JSONB(), "postgresql")`
  would match the spec.
- N4 `SessionLocal` is a function that builds a new `sessionmaker` per call (db.py:26-27). Callable shape
  matches `SessionLocal() -> Session`; not a `sessionmaker`, so `.configure()`/`.begin()` are unavailable.
- N5 Extra public names not in the plan: `api.worker.get_celery_app`, `api.vector.EMBEDDING_DIM`. Harmless.

## Check 3: PostgreSQL DDL without a server

Commands (from `fairmatch/`, `JWT_SECRET=x`,
`DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@127.0.0.1:1/fairmatch`, i.e. a closed port, so any
connection attempt would fail): `python -m alembic upgrade head --sql` -> rc 0 (output in
`scratchpad/up.sql`), `python -m alembic downgrade head:base --sql` -> rc 0 (`scratchpad/down.sql`).
Offline mode did not connect (closed port, rc 0). `op.get_bind().dialect.name` works in offline mode on
Alembic 1.20.0.

Upgrade DDL (PostgreSQL):
- `CREATE EXTENSION IF NOT EXISTS vector;` is the first statement after `alembic_version`, before every table. OK.
- `candidates.embedding VECTOR(384)` and `opportunities.embedding VECTOR(384)`, both nullable. OK.
- `CREATE INDEX ix_candidates_embedding_hnsw ON candidates USING hnsw (embedding vector_cosine_ops);` and the
  same for `ix_opportunities_embedding_hnsw`, emitted after the tables. OK.
- FKs: `candidates.user_id -> users.id`, `candidate_demographics.candidate_id -> candidates.id` (also PK),
  `allocation_runs.requested_by -> users.id`, `allocations.run_id/candidate_id/opportunity_id`. OK.
- `CONSTRAINT uq_allocation_run_algo_cand UNIQUE (run_id, algorithm, candidate_id)`, `UNIQUE (user_id)` on
  candidates, `UNIQUE (email)` on users. OK.
- Table creation order users -> candidates -> candidate_demographics -> opportunities -> allocation_runs ->
  allocations satisfies every FK.
- SQLite offline SQL contains no `vector`/`hnsw`/`extension` text (0 matches): PG-only guards work.

Downgrade DDL: `DROP INDEX IF EXISTS` x2, then `DROP TABLE` allocations, allocation_runs, opportunities,
candidate_demographics, candidates, users (children before parents, valid), then
`DROP EXTENSION IF EXISTS vector`, then the alembic_version delete.

Online SQLite round trip (`scratchpad/rt.db`): upgrade head -> 6 tables + alembic_version; downgrade base ->
only alembic_version; upgrade head again -> OK.

Model/migration parity (`scratchpad/c3_parity.py`: runs the migration's `upgrade()` against a recording
`op`, then diffs every column's compiled type, nullability, PK, unique and FK target plus unique constraints
against `Base.metadata`, on both postgresql and sqlite dialects, and diffs full `CreateTable` text):
- Same tables, same column names and order, same nullability/PK/FK/unique on every column.
- Drift (6 entries, 3 columns): `allocations.score`, `candidates.experience_years`,
  `opportunities.min_experience_years` are `Double` in models (from `Mapped[float]`, renders
  `DOUBLE PRECISION`) but `sa.Float` in the migration (renders `FLOAT`). On PostgreSQL `FLOAT` without precision is
  `double precision`, so storage is the same. `alembic check` on the SQLite DB still reports
  `modify_type ... FLOAT() -> Double()` for those three columns, so a future `--autogenerate` would emit
  spurious ops. Non-blocking; fix with `sa.Double` at migrations/versions/0001_initial.py:37, :54, :77 (or
  `mapped_column(Float)` in models).
- All other `CreateTable(...).compile(dialect=postgresql.dialect())` output is identical between models
  and migration (users, candidate_demographics, allocation_runs identical; the others differ only in the
  FLOAT line above).

Migration reliance on `api.vector.EmbeddingType`: importing `api.vector` with no `JWT_SECRET`/`DATABASE_URL`
loads only `api` and `api.vector` (no settings, no engine, no side effects). Safe.

Notes (non-blocking):
- N6 `migrations/env.py:4-6` imports `api.config.get_settings`, so every Alembic command (even `--sql`)
  needs `JWT_SECRET` set: without it -> `RuntimeError: JWT_SECRET is required` (verified). The Task 7 README
  must say so, or env.py could read `DATABASE_URL` without building the full Settings.
- N7 The downgrade's `DROP EXTENSION IF EXISTS vector` (0001_initial.py:109-110) drops an extension the
  upgrade may not have created (`IF NOT EXISTS`), and fails if any other object depends on it. Not required
  by the plan ("downgrade base leaves no tables"); consider removing it.
- N8 0001 imports the live `EmbeddingType`; any future change to that class (dimension, impl) silently
  rewrites the historical migration. Consider freezing it (`pgvector.sqlalchemy.Vector(384)` with a
  `sa.JSON` variant) inside the migration.
- N9 No `ON DELETE` rules: deleting a candidate that has demographics or allocations will fail on PostgreSQL.
  SQLite does not enforce FKs by default (see Check 4), so unit tests will not catch it (Task 6's
  "after deleting a row" test).
- N10 `created_at`/`finished_at` are `TIMESTAMP WITHOUT TIME ZONE` while models.py:11 writes
  `datetime.now(UTC)` (aware). See Check 4 for what comes back.

Result: DDL is correct for the plan's requirements. One non-blocking drift item (Float vs Double).

## Check 4: SQLite behaviours

Evidence: `scratchpad/c4_sqlite.py`, `scratchpad/c4_more.py` (both go through `get_engine`/`get_session`
with `DATABASE_URL=sqlite://`).

| Behaviour | Observed |
|---|---|
| Pool for `sqlite://` | `StaticPool` (single shared connection), `check_same_thread=False` |
| Serial sessions (1 thread, 50 write+read) | 0 errors, 50 rows |
| Concurrent sessions, 8 threads x 200 write+read | 43 errors `sqlite3.InterfaceError: bad parameter or other API misuse`; only 131/200 rows survive |
| Concurrent, 2 threads x 50 | 14 errors (`bad parameter or other API misuse`, `not an error`); 22/50 rows |
| Interleave: A flushes, B (other thread) raises -> rollback, A commits | A reports success but its row is gone (0 rows): B's rollback rolled back the shared connection's transaction |
| Same workload on file SQLite (`sqlite:///f.db`, QueuePool) | 0 errors, 200/200 rows |
| `get_session` commit on success / rollback on exception | commit kept (1), rollback discarded (True) |
| Duplicate `users.email` | `IntegrityError: UNIQUE constraint failed: users.email` |
| Second candidate for same `user_id` | `IntegrityError: UNIQUE constraint failed: candidates.user_id` |
| Duplicate (run_id, algorithm, candidate_id) | `IntegrityError` (covered by tests/api/test_models.py:50-71, passes) |
| NULL in NOT NULL column (email) | `IntegrityError: NOT NULL constraint failed` |
| Candidate with nonexistent `user_id=999`; demographics for nonexistent candidate | accepted: SQLite FKs are not enforced (no `PRAGMA foreign_keys=ON`) |
| JSON nested dict / list round trip (`metrics`, `fairness`) | exact |
| In-place JSON mutation (`run.metrics["k"] = v`, commit) | NOT persisted (plain `JSON`, no `MutableDict`) |
| `created_at` written as `datetime.now(UTC)` | read back naive (`tzinfo=None`) |
| EmbeddingType: 384 random float64 | bit-exact round trip, `list[float]` |
| EmbeddingType: `np.float32` ndarray input | stored and returned exactly (widened to float64); ndarray reassignment flushes fine |
| EmbeddingType: explicit `None` and omitted | both read back `None`, BUT raw storage is the JSON text `'null'` (`embedding IS NULL` = 0, `typeof = 'text'`); ORM `Candidate.embedding.is_(None)` counts 0 of 2 |
| Wrong length 3 / 64 / 385 / 0 | all accepted silently on SQLite, read back with the wrong length |
| Wrong length on PostgreSQL | EmbeddingType's PG bind processor does not check either (`[0.5, 0.5, 0.5]` rendered); the server would reject at INSERT (`expected 384 dimensions`) |
| NaN vector | accepted on SQLite (stored as non-standard JSON `NaN`); pgvector rejects NaN |
| `education_level=2` (core's int) | read back as `'2'` (str), confirms M1 |

### Blocking

M4 (BLOCKING, Tasks 5/7). `embedding` is pinned "nullable", but on SQLite `None` is stored as JSON `'null'`,
not SQL NULL, so SQL-level filters (`Candidate.embedding.is_(None)` / `.is_not(None)`) give the opposite of
PostgreSQL. Task 7's SQLite path ("candidates without an embedding yield an empty list") and Task 5's
idempotency query would diverge by dialect. Cause: api/vector.py:11 and :17 use `JSON()` with the default
`none_as_null=False`. Fix: return `JSON(none_as_null=True)` from `load_dialect_impl` (and use it as the impl
for non-PG). Verified in `scratchpad/c4_more.py`: explicit and omitted `None` both become SQL NULL and
`is_(None)` counts 2 of 2.

M5 (BLOCKING, Tasks 5/7). The plan pins "a `list[float]` of length 384", but no dialect validates length
(api/vector.py:19-22). Because Docker/PostgreSQL is unavailable, SQLite is the only test path, so a wrong
dimension passes every unit test and fails only on PostgreSQL. This is live already: the shared
`fake_embedder` is 64-d (tests/conftest.py:9), and Task 5's `test_embed_profile_task_stores_vector...` plus
Task 7's SQLite similarity tests would store 64-d vectors that PostgreSQL rejects. Fix: in
`process_bind_param` raise `ValueError` when `len(value) != EMBEDDING_DIM` (and optionally reject
non-finite values). Verified: 64-d becomes `StatementError (ValueError) embedding must have 384 dimensions, got 64`.
Then add a 384-d fake embedder fixture for API tests in tests/api/conftest.py (for example
`_FakeEmbedder` with `dim = 384`) and have Tasks 5/7 monkeypatch that one into `get_embedder`.
(M2, M4 and M5 can be one edit to api/vector.py: `impl = Vector(384)`, non-PG `JSON(none_as_null=True)`,
length check. The full class is in `scratchpad/c4_more.py` `FixedEmbedding`.)

### Non-blocking

- N11 `sqlite://` + `StaticPool` (pinned by the plan) is unsafe for any overlapping sessions: errors and
  silently lost commits with only 2 threads. Serial use (TestClient requests, eager Celery inside a request)
  is fine. Later tasks must not test the Review Focus "two runs submitted at once" by threading against
  `sqlite://`. Use sequential re-delivery, a file SQLite DB, or `@pytest.mark.db`. Optional hardening: a
  process-wide `threading.RLock` held for the lifetime of each session when the URL is in-memory.
- N12 Enable `PRAGMA foreign_keys=ON` for SQLite (an `event.listens_for(engine, "connect")` hook in
  `get_engine` and in the test `session` fixture) so FK violations, such as Task 6's "delete a row" test,
  fail in unit tests the same way they will on PostgreSQL.
- N13 JSON columns are not mutation-tracked; Task 6 must assign a new dict (`run.metrics = {**run.metrics,
  ...}`) or the models should use `MutableDict.as_mutable(JSON)`.
- N14 Timestamps: aware in, naive out. Use `DateTime(timezone=True)` in models and migration, or write naive
  UTC consistently. Otherwise comparing a loaded value with `datetime.now(UTC)` raises `TypeError`.

## Check 5: CachedEmbedder (fakeredis 2.40.0, redis-py 8.1.0)

Evidence: `scratchpad/c5_cache.py` (spy client that logs every `mget`/`pipeline`/`pipe.set`/`execute` and
any direct `get`/`set`), plus an inline 384-d random-vector probe.

| Behaviour | Observed |
|---|---|
| Key format | `emb:BAAI/bge-small-en-v1.5:<sha256 hex of utf-8 text>`, equal to the expected set. Value = raw float32 bytes (64-d fake -> 256 B) |
| Miss call (2 new texts) | `mget`, `pipeline`, 2x `pipe.set`, 1x `execute`; inner called once with both texts |
| All-hit call | `mget` only; inner not called |
| Partial hit + duplicate in one call (`[nursing, new, new, python sql, other]`) | 1 `mget`, 1 `pipeline`, 2 sets, 1 `execute`; inner got `['new text', 'other']` (deduped, misses only); duplicate rows equal; shape (5, 64) |
| Direct `get`/`set` outside the pipeline | never |
| Cached vs fresh bit-identical | NO. Fake embedder: max abs diff 1.1e-16. Realistic 384-d random unit vectors: cold vs warm max abs diff 5.55e-09 (float32 storage while the miss path returns float64). Also a miss result is not bit-identical to the inner output (re-normalisation, 1.1e-16) |
| Empty list | `(0, 0)` before any call, `(0, d)` after one; no Redis or inner calls (also covered by the test) |
| Unicode (accents, CJK, emoji) and `""` | OK; second call fully cached; `""` row is the zero vector (norm 0, no NaN) |
| Lone surrogate (`"\ud800"`) | raises `UnicodeEncodeError` from `text.encode('utf-8')` (embedding.py:37) |
| `redis.ConnectionError` / `redis.TimeoutError` / `redis.ResponseError` at `mget`, `pipeline()` or `execute()` | all fall back, results correct, shape (3, 64), nothing lost |
| builtin `ConnectionError` | falls back |
| builtin `TimeoutError`, `OSError` | propagate (not in `_REDIS_ERRORS`, embedding.py:12). redis-py normally wraps socket errors, so this is low risk |
| Poisoned cache: 3 bytes | `ValueError: buffer size must be a multiple of element size` (crash) |
| Poisoned: 8 B (2 floats), 0 B, 512 B (float64 of 64-d) | alone: silently returns the wrong shape `(1, 2)` / `(1, 0)` / `(1, 128)`; mixed with a good key: `ValueError` from `np.vstack` (crash) |
| 12 threads x 393 overlapping calls on one shared CachedEmbedder + FakeRedis | all results correct, 0 errors |
| Different `model=` values | distinct key namespaces |
| Inner without `model_name` | namespace `emb:default:...`, so different unnamed embedders collide |
| Real `redis.Redis.from_url` against a closed port | falls back correctly but takes 4.1 s (`127.0.0.1`) / 8.1 s (`localhost`) per `encode` on this Windows host (connect retries for mget and again for pipeline; no socket timeouts or retry limit configured, embedding.py:21) |
| `get_redis()` with `fakeredis://` | a new, empty, unshared `FakeRedis()` per call (two calls do not share state), so `get_embedder()` never hits the cache across calls in that mode |

### Blocking

M6 (BLOCKING per this review's acceptance rule "poisoned cache must not crash or return wrong shape").
embedding.py:49-52 trusts any cached blob. Wrong-size bytes either crash `encode` with `ValueError`, which
`_REDIS_ERRORS` does not cover, or silently return rows of the wrong dimension. The likely trigger is a
dimension or dtype change under the same model name, or two unnamed inner embedders sharing `emb:default:`.
Fix: treat a blob as a miss unless `len(b) % 4 == 0` and its decoded length matches the batch's
dimension. Simplest version: decode into a list, keep only blobs with `len(b) == 4 * dim` where `dim` is
`self._dim` or, when unknown, the most common size among the hits. Send everything else to the inner
embedder, overwrite it in the same pipeline, and wrap the decode in `try/except ValueError`. Add a test
with a 3-byte and an 8-byte poisoned key.

### Non-blocking

- N15 Cold and warm results differ by about 5e-9 because the miss path returns float64 while hits return
  float32-rounded values. Return `fresh.astype(np.float32).astype(float)` on the miss path so the same text
  always gives identical bits (deterministic re-runs and tie-breaks in allocation).
- N16 Fallback latency when Redis is down: 4-8 s per call here. Build the client with
  `socket_connect_timeout`/`socket_timeout` (for example 0.5 s) and a bounded retry, or skip the cache for
  a short cool-down after a failure.
- N17 Memoise `get_redis()` (one pool and, for `fakeredis://`, one shared fake server) and consider
  memoising `get_embedder()`. As written, every call builds a new `SentenceTransformerEmbedder`, so each
  Celery task reloads the model, and the fake mode never shares a cache.
- N18 Use `text.encode("utf-8", "surrogatepass")` in `_key` and add `OSError` to `_REDIS_ERRORS`.
- N19 No TTL on cache keys (unbounded growth). Acceptable for an MCA demo; mention it in the README.

## Check 6: Celery app (celery 5.6.3)

Evidence: `scratchpad/c6_celery.py`, `scratchpad/c6_sim.py`, `python -m celery -A api.worker.celery_app report`.

| Behaviour | Observed |
|---|---|
| `import api.worker` and `import api.services.embedding` with no `JWT_SECRET` | OK (no settings at import) |
| `api.worker.celery_app` with no `JWT_SECRET` | `RuntimeError: JWT_SECRET is required` (expected: the app needs settings) |
| Under settings (`CELERY_EAGER=true`, `REDIS_URL=redis://r:6379/3`) | `task_always_eager=True`, `task_eager_propagates=True`, `broker_url` and `result_backend` = `redis://r:6379/3` |
| Serialization | `task_serializer=json`, `result_serializer=json`, `accept_content=['json']` (`result_accept_content=None`, so it inherits json), `event_serializer=json`; a pickle payload raises `ContentDisallowed` |
| Identity | `celery_app is get_celery_app()` on repeated access |
| Tasks defined | none besides `celery.*` built-ins (correct for Task 4) |
| Settings change without `get_celery_app.cache_clear()` | app keeps the old value (`eager=True` after `CELERY_EAGER=false`) |
| After `cache_clear()` | a NEW app object with the new value; tasks bound to the old app keep the old config (see M3) |
| `celery -A api.worker.celery_app report` with JWT_SECRET | resolves via module `__getattr__`, transport redis |
| Same without JWT_SECRET | `RuntimeError: JWT_SECRET is required` (fine for a worker) |
| `hasattr(api.worker, "nope")` | False (the `__getattr__` raises `AttributeError` correctly) |

Assessment: the configuration values are right, and the plan's `test_celery_eager_flag_follows_settings`
passes. The cache-plus-`__getattr__` shape is the problem recorded as M3. The settings_env fixture clears
`get_settings` but not `get_celery_app`, so "eager follows settings" only holds for the first app built in
a process, and tasks added in Tasks 5/6 cannot use `@celery_app.task` inside worker.py. The fix is in M3.

## Check 7: cross-module fixtures (tests/api/conftest.py)

`git diff HEAD -- fairmatch/tests/api/conftest.py`: +35 lines, all from Task 2 (`import os`,
`pytest_collection_modifyitems` db-skip hook, `session` fixture). Task 4 did not edit conftest; its local
fixtures (`r` in test_embedding_cache.py:22, autouse `_fresh` in test_worker_config.py:6) have unique
names. No duplicated or contradictory fixtures; root `tests/conftest.py` (`fake_embedder`, `_no_openai_key`)
is untouched. Probe: `scratchpad/test_c7_fixtures.py`, run with `python -m pytest -p tests.api.conftest -s`.

| Need of later tasks | Status |
|---|---|
| `settings_env` autouse (JWT_SECRET, `sqlite://`, CELERY_EAGER) | present, unchanged from Task 1 |
| `client` | present (`TestClient(create_app())`) |
| db skip hook | works; helpful reason (Check 1). Lives in tests/api/conftest.py, which covers Task 7's `test_search_pg.py` too |
| `session` fixture usable together with `client` | NO. The fixture builds its own private engine (conftest.py:46-48). Probe: `session.get_bind() is get_engine()` -> False; app engine tables `[]`; reading a seeded row through `get_session` (what endpoints use) -> `OperationalError: no such table: users` |
| Per-test DB isolation for the app engine | NO. `get_engine()` stays cached across tests: a row committed in one test was still visible in the next (`row from previous test still visible: True`). tests/api/test_models.py:98 and :116 call `reset_engine_cache()` at start but never at the end, so they leave tables and rows behind |
| Redis in tests | `settings_env` leaves `REDIS_URL=redis://localhost:6379/0`, so any un-monkeypatched `get_embedder()`/`get_redis()` hits a real (absent) Redis with a 4-8 s fallback per call |
| Order sensitivity today | none: `test_models` first or last, all pass (18/18, 11/11) |

### Blocking

M7 (BLOCKING, Tasks 3, 5, 6, 7). Task 3 Step 3 requires "the shared session fixture creates tables on the
in-memory engine per test", and Tasks 5/6 seed rows directly (for example `test_total_seats_zero_422`
"set it directly in the DB"), then call the API. With the current fixture those rows are invisible to the
app, and app-side state leaks between tests. Fix in tests/api/conftest.py:

```python
@pytest.fixture(autouse=True)
def settings_env(monkeypatch):
    ...existing env...
    monkeypatch.setenv("REDIS_URL", "fakeredis://")
    get_settings.cache_clear()
    reset_engine_cache()
    yield
    reset_engine_cache()
    get_settings.cache_clear()

@pytest.fixture
def session():
    from api import models  # noqa: F401
    from api.db import Base, SessionLocal, get_engine
    Base.metadata.create_all(get_engine())   # the app's StaticPool in-memory engine
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()

@pytest.fixture
def client(session):   # same engine as the endpoints; tables exist
    return TestClient(create_app())
```

Tests must `commit()` seeded rows before calling `client` (single shared connection, see N11). With M3's
fix, `settings_env` should also call `configure_celery()`.

### Non-blocking

- N20 `get_session` commits after the endpoint returns. Endpoints that must map DB errors to HTTP codes
  (Task 3's 409 duplicate email, Task 5's 409 second profile, Task 5's "enqueue after commit") must
  `flush()`/`commit()` inside the endpoint rather than rely on the dependency's teardown commit.

## Verdict

VERDICT: PASS_WITH_FIXES. 7 blocking issues.

What passes: the fast suite (136) and ruff are clean; `core/`, `requirements.txt` and `pyproject.toml` are
untouched; the db test skips with a helpful reason. The PostgreSQL DDL rendered offline is correct:
extension first, `VECTOR(384)`, two HNSW `vector_cosine_ops` indexes, all FKs and unique constraints, and a
valid downgrade order. Model/migration parity holds apart from cosmetic Float/Double drift. The
cache keying and batching (one `mget`, one pipeline) and the Redis-error fallback are correct, and so are
the Celery JSON/eager configuration values.

Blocking (fix before Tasks 3/5/6/7 start; all are local edits):

| # | Where | Problem | Fix |
|---|---|---|---|
| M1 | api/models.py:33, :54; migrations/versions/0001_initial.py:38, :55; tests/api/test_models.py:28,31,55,57,87,89 | `education_level`/`min_education_level` are `String(50)`; core and plan use int 0..4 (an int reads back as `'2'`) | `Mapped[int]` / `sa.Integer`; int values in tests |
| M2 | api/vector.py:11 | `impl = JSON`, so `Candidate.embedding.cosine_distance(...)` (pinned in Task 7) raises `AttributeError` | `impl = Vector(EMBEDDING_DIM)`; keep JSON for non-PG in `load_dialect_impl` |
| M3 | api/worker.py:8-25 | `celery_app` exists only through `__getattr__`. In-module `@celery_app.task` raises `NameError`; `@get_celery_app().task` needs JWT_SECRET at import; tasks bind to a stale app after `cache_clear` | module-level `celery_app = Celery("fairmatch")` plus idempotent `configure_celery()` (from `create_app`, `settings_env`, worker start) |
| M4 | api/vector.py:11, :17 | `None` stored as JSON `'null'` on SQLite, so `embedding.is_(None)` matches 0 rows (PG gives real NULL) | `JSON(none_as_null=True)` for non-PG |
| M5 | api/vector.py:19-22 (+ tests/conftest.py:9 64-d fake) | length 384 never enforced; 64-d vectors pass on SQLite and would fail only on PG | raise `ValueError` if `len != 384`; add a 384-d fake embedder fixture in tests/api/conftest.py for Tasks 5/7 |
| M6 | api/services/embedding.py:49-52 | a poisoned or wrong-size cache blob crashes `encode` (`ValueError`) or returns the wrong shape | treat a blob with bad size or dimension as a miss, re-encode and overwrite; add a test |
| M7 | tests/api/conftest.py:37-55 (+ test_models.py:98, :116) | `session` uses a private engine (rows invisible to `client`/`get_session`: `no such table: users`), and app engine state leaks across tests | bind `session` to `get_engine()`; `reset_engine_cache()` in `settings_env`; `client` depends on `session`; set `REDIS_URL=fakeredis://` |

M2, M4 and M5 are one edit to api/vector.py; a verified class is in
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\c4_more.py`
(`FixedEmbedding`). A verified worker shape for M3 is in `scratchpad/sim/worker_fix2.py`.

Non-blocking notes: N1-N20 above. The most important for later tasks:
- N11: `sqlite://` StaticPool breaks under any concurrent sessions. Do not thread-test against it.
- N12: SQLite FKs are not enforced.
- N13: JSON columns are not mutation-tracked.
- N14: timestamps go in tz-aware and come back naive.
- N15: cold and warm embeddings differ by about 5e-9.
- N16/N17: Redis-down latency is 4-8 s per call; `get_redis`/`get_embedder` are not memoised.
- Float/Double drift flagged by `alembic check` (Check 3).
- N6: Alembic needs `JWT_SECRET`.
- N7: the downgrade drops the `vector` extension.

Not verified (no Docker): live `alembic upgrade head` on PostgreSQL 16 + pgvector and
`test_migration_upgrade_head_creates_hnsw_indexes`. Re-run `pytest -m db -v` with `TEST_DATABASE_URL`
(a `postgresql+psycopg://` URL) when Docker is available.
