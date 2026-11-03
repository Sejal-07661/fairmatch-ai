# M2 Judge, Wave 1 recheck (fixes for M1-M7)

Judge date: 2026-11-03. Read-only re-verification of the uncommitted working tree on `master` (HEAD 5671fb4)
against the blocking issues in `docs/superpowers/reports/m2-judge-wave-1.md`. Docker/PostgreSQL unavailable:
PG behaviour is checked through Alembic offline SQL and dialect compilation. All scratch scripts live in
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\`
(prefix `r_` for this recheck).

VERDICT: FAIL. 2 blocking issues. M1, M2, M3, M4, M5 and M7 are fixed. M6 is only partly fixed:
a `str` blob crashes `encode`, and a lone wrong-size blob is trusted on the production path. New B1:
`celery -A api.worker.celery_app worker` is never configured, so it connects to amqp://localhost. Details are in
"Verdict" at the end.

## Check 1: suite, lint, untouched files

| Item | Result |
|---|---|
| `python -m pytest -m "not slow and not llm and not db" -q` | 145 passed, 3 deselected (20.2 s); was 136 |
| `python -m ruff check .` | All checks passed |
| `git diff HEAD --stat -- core requirements.txt pyproject.toml` | empty; `git status --porcelain` on the same paths also empty |
| `pytest tests/api -rs` | 27 passed, 1 skipped (`test_migrations_pg.py:14: set TEST_DATABASE_URL ...`, helpful reason) |
| Reordered api files (worker, models, cache first) | all pass |

Tracked-file diff vs HEAD: only `api/main.py` (+2) and `tests/api/conftest.py` (+59/-1). The other touched files
(`api/vector.py`, `api/models.py`, `api/worker.py`, `api/services/embedding.py`, the migration and the new tests)
are untracked, so they were reviewed by reading them in full.

Result: PASS.

## Check 2: M1 (education columns are integer)

Evidence: `scratchpad/r_m1.py`, `scratchpad/r_up.sql`, `scratchpad/r_down.sql`, `scratchpad/r_rt.db`.

| Item | Result |
|---|---|
| models.py:33, :54 | `education_level: Mapped[int]`, `min_education_level: Mapped[int]` (compiled `INTEGER`) |
| 0001_initial.py:38, :55 | `sa.Integer`, `nullable=False` |
| SQLite ORM round trip (3 and 4 written) | read back `3` / `4`, `type int`; `typeof()` = `integer`; reflected `INTEGER`; `education_level >= 3` filter counts numerically |
| `alembic upgrade head --sql`, `postgresql+psycopg://...@127.0.0.1:1/...` (closed port) | rc 0, no connection attempted |
| `diff` vs the first judge's `up.sql` | exactly two lines changed: `education_level VARCHAR(50)` -> `INTEGER`, `min_education_level VARCHAR(50)` -> `INTEGER`. Everything else is byte-identical: extension first (line 10), `VECTOR(384)` x2, two `USING hnsw (embedding vector_cosine_ops)` indexes after the tables, all 6 FKs, `UNIQUE (email)`, `UNIQUE (user_id)`, `uq_allocation_run_algo_cand` |
| `alembic downgrade head:base --sql` | rc 0, byte-identical to the first run: drop 2 indexes, 6 tables child-first, extension, version row |
| Online SQLite: upgrade head, downgrade base, upgrade head | OK; edu columns `INTEGER`, embedding `JSON`; after downgrade only `alembic_version` |
| `alembic check` on that DB | only the pre-existing Float/Double drift on 3 columns (non-blocking, unchanged); no edu drift |
| tests/api/test_models.py | ints used (`2`, `0`), plus an explicit `isinstance(..., int)` assertion at :42 |

Result: M1 FIXED.

## Check 3: M2, M4, M5 (api/vector.py)

Evidence: `scratchpad/r_m2m4m5.py` (own script, through `get_engine`/`SessionLocal` on `sqlite://`) plus an inline
probe of the psycopg dialect's bind/result processors.

api/vector.py now: `impl = Vector(EMBEDDING_DIM)`, `load_dialect_impl` -> `Vector(384)` on postgresql and
`JSON(none_as_null=True)` elsewhere, `process_bind_param` converts with `float(x)`, rejects `len != 384`
and non-finite values, `process_result_value` returns `list[float]`.

### M2: pgvector comparators

| Expression | postgresql compile |
|---|---|
| `Candidate.embedding.cosine_distance([0.0]*384)` | `candidates.embedding <=> %(embedding_1)s` |
| `Candidate.embedding.l2_distance([0.0]*384)` | `candidates.embedding <-> %(embedding_1)s` |
| `Candidate.embedding.max_inner_product(...)` | `candidates.embedding <#> %(embedding_1)s` |
| `Opportunity.embedding.l2_distance(...)` | `opportunities.embedding <-> ...` |
| `select(Candidate.id).order_by(...cosine_distance(...)).limit(5)` | `ORDER BY candidates.embedding <=> %(embedding_1)s LIMIT ...` |

PG processors (psycopg dialect): bind `[0.25]*384` -> text `[0.25,0.25,...]`; np.float32 array binds; result
text `[0.1,...]` -> `list` of 384 Python `float`; `None` -> `None`. The PG DDL is unchanged (`VECTOR(384)`, Check 2).
Result: M2 FIXED.

### Vector impl vs SQLite DDL

`CreateTable(Candidate.__table__)` on the sqlite dialect renders `embedding JSON`; `create_all` on `sqlite://`
succeeds and `pragma_table_info` reports `('embedding', 'JSON')`. The Alembic SQLite path also gives `JSON`
(Check 2). No breakage.

### M4: None is SQL NULL

| Case | Raw SQLite (`embedding IS NULL`, `typeof`) |
|---|---|
| explicit `embedding=None` | `1`, `null` |
| omitted | `1`, `null` |
| 384-d value | `0`, `text` |
| value later set to `None` and committed | `1` |

ORM counts with 2 NULL + 1 value: `is_(None)` = 2, `is_not(None)` = 1, `== None` = 2. Read-back of all three
is `None`. Result: M4 FIXED.

### M5: dimension and finiteness enforced

| Input | Outcome (SQLite flush/commit) |
|---|---|
| 64-d list | `StatementError` wrapping `ValueError: embedding must have 384 dimensions, got 64` |
| 385-d list | same, `got 385` |
| empty list | same, `got 0` |
| NaN at index 0 | `StatementError` wrapping `ValueError: embedding must contain only finite values` |
| `+inf`, `-inf` | same `ValueError` |
| `np.full(384, nan)` | same `ValueError` |
| 2-D ndarray `(1, 384)` | `StatementError` wrapping `TypeError: only 0-dimensional arrays can be converted...` (rejected, different type) |
| `"x" * 384` (str) | `StatementError` wrapping `ValueError: could not convert string to float` |
| 384 random float64 list | stored, read back bit-exact (`==`), elements `float` |
| 384 np.float32 ndarray | stored, read back equal to `[float(x) for x in a]` and `np.array_equal` as float32 |
| 384 np.float64 ndarray | bit-exact |
| subnormal `5e-324`, `1.7e308` | bit-exact |
| PG dialect bind, 64-d / NaN | same `ValueError` raised in `process_bind_param`, before the driver |

Result: M5 FIXED (the 384-d API test fixture is checked under M7).

Non-blocking notes:
- R1 On the sqlite dialect `cosine_distance` also compiles (to `candidates.embedding <=> ?`), which SQLite
  cannot execute. Task 7's SQLite path must keep using Python cosine and never build this expression there.
- R2 A 384-character digit string (for example `"1" * 384`) would pass `float(x)` per character. Harmless in
  practice; a `isinstance(value, (str, bytes))` guard would close it.

## Check 4: M3 (Celery app shape)

Evidence: `scratchpad/r_celery/r_tasks.py` (a scratch module defining `@celery_app.task`),
`scratchpad/r_celery/r_m3.py` (socket `connect`/`create_connection` patched to record and refuse every attempt),
`scratchpad/r_celery/r_fixmod.py`, `python -m celery -A api.worker.celery_app report|worker`.

api/worker.py now: module-level `celery_app = Celery("fairmatch")` with JSON-only serializers and
`task_eager_propagates=True` set at import (no settings access); `configure_celery()` applies `broker_url`,
`result_backend`, `task_always_eager` from `get_settings()` (`fakeredis://` -> `memory://` / `cache+memory://`);
`get_celery_app()` is an alias. `create_app()` calls `configure_celery()` (main.py:9); `settings_env` calls it
after `get_settings.cache_clear()` (conftest.py:20).

| Item | Result |
|---|---|
| `from api.worker import celery_app` + `import r_tasks` with no `JWT_SECRET` | OK; `main='fairmatch'`; task `r_tasks.add` registered; pre-configure `broker_url=None`, eager False |
| `configure_celery()` with no `JWT_SECRET` | `RuntimeError: JWT_SECRET is required` (expected, settings needed) |
| `REDIS_URL=fakeredis://`, `CELERY_EAGER=true` | same app object; broker `memory://`, backend `cache+memory://`, eager True, propagates True |
| `r_tasks.add.delay(2, 3)` | `EagerResult`, `.get()` = 5, body ran in-process |
| task raising `KeyError` via `.delay()` | `KeyError` propagates |
| `REDIS_URL=redis://10.255.255.1:6379/4`, eager | broker and backend = that URL; `.delay(4,5).get()` = 9 and `apply_async` = 2; recorded connect attempts: `[]` |
| `CELERY_EAGER=false` after `cache_clear()` + `configure_celery()` | eager False; `.delay()` returns `AsyncResult` PENDING, body not run (queued on `memory://`) |
| back to `CELERY_EAGER=true` | `.delay(8,8).get()` = 16, body ran: settings change honoured for a task bound at import |
| idempotency (3 calls) | same object each time, identical conf snapshot, tasks still registered |
| `find_app("api.worker.celery_app")`, `find_app("api.worker")` | both resolve to `celery_app` |
| `create_app()` | applies settings (eager False, broker `redis://zz:6379/9` after the env change); no connection attempted |

M3 as stated in the first verdict (in-module `@celery_app.task`, no JWT at import, eager follows settings for
bound tasks) is FIXED.

### NEW BLOCKING B1: the worker process is never configured

My first verdict's M3 fix said to call `configure_celery()` "from `create_app()`, from the `settings_env`
fixture ..., and at worker start-up". The start-up call is missing. The plan's README command
(`celery -A api.worker.celery_app worker`, plan line 173) imports `api.worker` only, so `configure_celery()`
never runs in the worker:

| Command (`JWT_SECRET=s`, `REDIS_URL` set) | Observed |
|---|---|
| `python -m celery -A api.worker.celery_app report` (`REDIS_URL=redis://r:6379/3`) | `transport:amqp results:disabled` (the first judge run showed `transport redis`, so this is a regression from the M3 rewrite) |
| fresh `import api.worker`, settings valid | `broker_url=None`, `result_backend=None`; `connection_for_write()` -> `amqp://guest:**@localhost:5672//` |
| `celery -A api.worker.celery_app worker --pool=solo` (`REDIS_URL=fakeredis://`) | banner `transport: amqp://guest:**@localhost:5672//`, `results: disabled://`, then `Cannot connect to amqp://guest:**@127.0.0.1:5672//` in a loop |

Effect: the API (configured by `create_app`) enqueues to Redis while the worker listens on RabbitMQ at
localhost, so in a real deployment no `embed_profile`/allocation task (Tasks 5/6) ever runs and run status stays
`pending`. Every unit test is eager, so nothing in the suite catches it.

Fix (verified with `scratchpad/r_celery/r_fixmod.py`, which adds only this hook): in api/worker.py after
`configure_celery` (which ends at api/worker.py:27):

```python
from celery.signals import celeryd_init

@celeryd_init.connect
def _configure_worker(**_):
    configure_celery()
```

With the hook, `celery -A r_fixmod.celery_app worker --pool=solo` shows `transport: memory://`,
`results: memory:///`, lists `r_tasks.add` and reaches `ready` for `REDIS_URL=fakeredis://`; with
`REDIS_URL=redis://127.0.0.1:1/0` it shows `transport: redis://...:1/0` and `results: redis://127.0.0.1:1/0`.
Add a test: `celeryd_init.send(sender="t", instance=None, conf=celery_app.conf, options={})` after setting
`REDIS_URL=redis://example:6379/2`, then assert `celery_app.conf.broker_url == "redis://example:6379/2"`.
(`celery report`/`inspect` would still show amqp because they do not fire `celeryd_init`. That is acceptable
for this project. Alternatively call `configure_celery()` at import inside `try/except RuntimeError`.)

Non-blocking:
- R3 `configure_celery()` updates conf, but `celery_app.backend` is cached once accessed: after
  `cache+memory://` was used, switching to `redis://127.0.0.1:1/0` left the same `CacheBackend` object
  (`same object: True`). Harmless in eager tests and in production, where it is configured once. A Task 5/6 test
  that reads `AsyncResult(id).state` after changing settings in the same process would see the old backend.

## Check 5: M6 (CachedEmbedder and poisoned cache)

Evidence: `scratchpad/r_m6.py` (poison matrix, Spy client counting `mget`/`pipeline`/`execute`/direct
`get`/`set`, inner embedder that returns non-normalised float64), `scratchpad/r_m6_helpers.py`,
`scratchpad/r_m6b.py` (bit identity, dimension change, fallback), `scratchpad/r_embedding_fixed.py` +
`scratchpad/r_m6_fixcheck.py` (proposed fix, verified).

What changed (embedding.py:49-80): blobs are decoded only when `len(b) % 4 == 0 and len(b) > 0`; the expected
width is `self._dim`, or the most common decoded width when `self._dim` is None; rows of another width become
misses and are re-encoded and written in the same pipeline; misses are rounded through float32
(line 67); if the final rows still have mixed widths, the whole batch is re-encoded by the inner (lines 77-78).

Modes: `warm` = the same CachedEmbedder already returned a batch (so `_dim` is known); `mixed` = a fresh
CachedEmbedder, 1 poisoned key + 2 good keys; `alone` = a fresh CachedEmbedder encoding only the poisoned
text. A fresh CachedEmbedder is the production path: `get_embedder()` (embedding.py:84-85) builds a new one
on every call, so `_dim` is always None there, and Task 5's `embed_profile` encodes one text per call.

| Poisoned value | warm | mixed | alone (fresh, single text) |
|---|---|---|---|
| 3 bytes | correct, healed | correct, healed | correct, healed |
| 8 bytes (2 floats), 4-d and 384-d inner | correct, healed | correct, healed | **returns shape (1, 2)**, inner not called, not healed |
| empty bytes | correct, healed | correct, healed | correct, healed |
| NaN x dim (right size) | returns NaN rows, not healed | NaN rows, not healed | NaN row, not healed |
| float64 bytes of the right vector (2 x dim float32s) | correct, healed | correct, healed | **returns (1, 8) / (1, 768)** |
| float32 of half width | correct, healed | correct, healed | **returns (1, 2) / (1, 192)** |
| `str` with `len % 4 == 0` | **CRASH `TypeError: a bytes-like object is required, not 'str'`** | **CRASH** | **CRASH** |
| `str` of length 3 | correct, healed | correct, healed | correct, healed |

Where the result is correct, every call made exactly 1 `mget`, 1 `pipeline`, 1 `execute`, 0 direct
`get`/`set`, and 1 inner call, and the poisoned key was overwritten with `4 * dim` bytes in that pipeline.
Mixed-width rows were never returned (every output had one width). Only 3 of the 8 cases still fail.

Majority-poisoned (fresh embedder, 2 of 3 keys 8 bytes): the output is correct (3, 384), but the inner is
called twice (`['c']`, then `['a','b','c']`), only `c` is written, and `a`/`b` are NOT healed. Three repeated
fresh calls showed the same thing every time (`sets` = only `c`, 2 inner calls, `a still poisoned: 8B`).

Inner whose dimension changes (same instance, 8 -> 5): call 2 returns (3, 5) with one width (2 inner calls,
1 mget, 1 execute), and the old 8-d keys stay. Call 3 heals them (`{'a': 5, 'b': 5, 'c': 5}`) and call 4 is
all hits. An all-hit call after the inner changes again (-> 7) serves the stale width 5, which is unavoidable
without a declared dimension. A hit+miss call returns (2, 7) with one width.

Bit identity and norms (384-d, non-normalised float64 inner): miss result vs later hit (fresh instance and same
instance) `np.array_equal` True; a partial-hit row equals its earlier miss row exactly; a new text's miss and
its later hit are identical; norms are exactly 1.0; max diff vs a pure float64-normalised inner 6.2e-9 (< 1e-6).
Rounding the miss path through float32 resolves the first judge's N15.

Redis errors: `redis.ConnectionError`, `redis.TimeoutError`, `redis.ResponseError` and builtin
`ConnectionError` raised at `mget`, `pipeline()` or `execute()`: all 12 combinations fall back with correct
(3, 384) output, equal to an uncached run.

### M6 status: PARTIALLY FIXED, still blocking

The first verdict's M6 table listed "alone: silently returns the wrong shape (1, 2) / (1, 0) / (1, 128)".
Only the `(1, 0)` case is fixed. On the production path (fresh CachedEmbedder, single text) a wrong-size blob
whose length is a multiple of 4 is still trusted. The downstream effect: M5 then rejects the DB write
(`embedding must have 384 dimensions`), and since the key is never overwritten, that text can never be
embedded again until someone deletes the key by hand. A `str` value of length `4k` (for example a client
built with `decode_responses=True`, or a key written by another tool) crashes `encode` with `TypeError`,
which neither the `except ValueError` (line 55) nor `_REDIS_ERRORS` catches. (Note: my first verdict's
suggested fix, "the most common size among the hits when unknown", did not cover the single-text case. The
fix below replaces it.)

Fix (verified: `scratchpad/r_m6_fixcheck.py` runs the patched copy `scratchpad/r_embedding_fixed.py` over
42 cases (dims 4 and 384; 3B, 8B, empty, NaN, float64, half-width, str; mixed/alone/majority). Result:
0 failures. Every case gives the correct shape and values, heals the key, and makes 1 mget and 1 execute):
1. embedding.py:30, :34: add `dim: int | None = None` to `CachedEmbedder.__init__` and seed
   `self._dim = dim`; embedding.py:85: `CachedEmbedder(SentenceTransformerEmbedder(), get_redis(),
   dim=EMBEDDING_DIM)` (import `EMBEDDING_DIM` from `api.vector`). The plan's signature stays compatible
   because the new argument is an optional keyword.
2. embedding.py:52: `if isinstance(b, (bytes, bytearray, memoryview)) and len(b) > 0 and len(b) % 4 == 0:`.
3. embedding.py:54: after decoding, `if not np.isfinite(vec).all(): vec = None` (heals NaN/inf blobs, which
   M5 would otherwise reject forever).
4. Add tests: fresh `CachedEmbedder(..., dim=384)` with a single 8-byte key returns (1, 384) and heals it;
   a Spy client whose `mget` returns `"abcd" * 384` does not crash.

Non-blocking:
- R4 The mixed-width fallback (embedding.py:77-78) re-encodes the whole batch, but it does not write those
  rows, so poisoned keys under a majority-poison are never healed and every fresh call pays two inner calls.
  With fix 1, this branch only runs when the inner itself changes width. Consider writing `by_text` after
  this branch (still one pipeline).

## Check 6: M7 (tests/api/conftest.py fixtures)

Evidence: `scratchpad/r_m7/test_r_m7.py` (8 tests, run with `-p tests.conftest -p tests.api.conftest --rootdir .`),
`scratchpad/r_m7/test_r_m7_uncommitted.py`, and `scratchpad/r_m7b/` (a copy of the test file plus a scratch
`conftest.py` that re-exports the project fixtures, so it can run in one session with `tests/api`).

conftest now: `settings_env` sets `REDIS_URL=fakeredis://`, clears settings, `reset_engine_cache()`,
`configure_celery()`, and on teardown `reset_engine_cache()` and clears settings again. `session` runs
`create_all(get_engine())` on the app's StaticPool engine and yields `SessionLocal()`. `client(session)`
returns `TestClient(create_app())`. `fake_embedder_384` returns `_FakeEmbedder384` (crc32 word hashing into 384
buckets, L2-normalised).

| Probe | Result |
|---|---|
| Row committed through `session`, read through a real FastAPI route that uses `Depends(get_session)` (registered on `client.app` in the test) | `GET /_judge/users` -> 200 `["seed@x.com"]`; `session.get_bind() is get_engine()` True |
| Next test: same route plus `session` | `[]` and count 0 (no leak); a `POST` through the route (dependency commit) is visible to `session` after `expire_all()` |
| Third test (`session` only) | count 0 |
| Test without fixtures after those | `get_engine.cache_info().currsize == 0` (engine reset between tests) |
| `get_redis()` inside a test | `fakeredis.FakeRedis` (no real Redis, no 4-8 s fallback) |
| Celery inside a test | `task_always_eager True`, `broker_url memory://` |
| Reversed order (test 2, then 1, then 3) | 3 passed |
| `tests/api` + scratch dir in one session, both orders | 35 passed, 1 skipped each time (test_models' mid-test `reset_engine_cache()` calls do not leak into the scratch tests and the reverse is also clean) |
| Fast suite | 145 passed (Check 1) |

`fake_embedder_384`:

| Probe | Result |
|---|---|
| 5 texts | shape (5, 384), finite |
| norms | non-empty rows within 1e-12 of 1 |
| `""` and `"!!!"` (no word tokens) | exact zero vectors (no NaN) |
| duplicate text | identical rows |
| `encode([])` | shape (0, 384) |
| determinism across processes, `PYTHONHASHSEED` = 0, 1, 12345, random | one sha256 digest across the 4 subprocesses, equal to the in-process digest (crc32, not `hash()`) |
| its output stored in `Candidate.embedding` | accepted by the 384-d check; read back equal to `[float(x) for x in vec]` |

Result: M7 FIXED.

Non-blocking:
- R5 Because `sqlite://` uses StaticPool (one shared connection), a row only `flush()`ed (not committed) in
  `session` is also visible to the app (`uncommitted row seen by app: 1`). Tests pass either way, but a test
  can then pass by accident when the endpoint's own commit is missing. Later tasks should keep committing
  seeded rows, and assert persistence through a fresh `SessionLocal()` after `expire_all()`.
- R6 tests/api/test_models.py:97-101 requests `session` and then calls `reset_engine_cache()`, which disposes
  the engine that the fixture's session is bound to. Harmless today; the test should drop the `session`
  argument (as `test_get_session_commits_on_success` at :115 already does) or skip the manual reset.
- R7 The test-only probe `test_session_fixture_visible_to_app_and_no_leak` (test_models.py:166-177) reads
  through `get_session()` directly and only asserts `app is not None and create_app is not None` about the
  app. It does not hit a route. The scratch test above covers the route path; Task 3's first real route test
  will cover it permanently.

## Check 7: regressions, dead code, Global Constraints

Read: `git diff HEAD` (api/main.py, tests/api/conftest.py) and the full current text of the untracked
files api/vector.py, api/models.py, api/worker.py, api/services/embedding.py,
migrations/versions/0001_initial.py, tests/api/test_models.py, test_embedding_cache.py and
test_worker_config.py. The agents' fix notes are in m2-task-2-report.md and m2-task-4-report.md.

- Regression: B1 (Check 4). The M3 rewrite removed the only place where the worker process picked up settings.
  The first judge run of `celery report` showed transport redis. It now shows `transport:amqp results:disabled`.
- The conflict raised in the Task 2 report ("REDIS_URL=fakeredis:// breaks 2 Task 4 tests") is resolved:
  worker.py:20-21 maps `fakeredis://` to `memory://` / `cache+memory://`, and all 27 api tests pass.
- Dead code: embedding.py:55 `except ValueError` is unreachable for `bytes` (the `len % 4 == 0` guard already
  prevents the only `ValueError`), and it misses the `TypeError` that a `str` blob actually raises (M6).
  `get_celery_app()` is now only an alias used by one test. That is harmless, and the first verdict allowed it.
- Global Constraints: `core/`, requirements.txt and pyproject.toml are untouched. No new dependencies
  (`celery.signals`, used by the B1 fix, is part of celery). Unit tests use no external services
  (fakeredis, eager Celery, in-memory SQLite, verified in Check 6). Embedding dimension 384 is now enforced
  (M5). The `OPENAI_API_KEY` autouse fixture is untouched (`tests/conftest.py` not modified).
- The plan's pinned interfaces still hold: `CachedEmbedder(inner, client, model=None)`,
  `encode(texts) -> np.ndarray`, `get_redis()`, `get_embedder()`, `celery_app` importable from
  `api.worker`, `get_engine`/`SessionLocal`/`get_session`/`reset_engine_cache`. The M6 fix below only adds an
  optional `dim=` keyword.
- Model/migration parity: the edu columns match. The Float/Double drift from the first verdict is unchanged
  (non-blocking).
- No stray files: `git status` after all probes shows only this report added (all scratch output stays in the
  scratchpad).

## Verdict

VERDICT: FAIL. 2 blocking issues (M6 remainder, new B1).

| Issue | Status | Evidence |
|---|---|---|
| M1 education columns int | FIXED | Check 2: INTEGER in models, migration and PG/SQLite DDL; int round trip; offline DDL otherwise byte-identical |
| M2 pgvector comparators | FIXED | Check 3: `<=>`, `<->`, `<#>` on postgresql; PG processors OK; SQLite DDL still JSON |
| M3 Celery app shape | FIXED as specified | Check 4: `@celery_app.task` works, import needs no JWT, eager `.delay()` follows settings, memory transports for `fakeredis://`, no connection in eager mode, idempotent, `find_app` resolves, `create_app` calls it |
| M4 None is SQL NULL | FIXED | Check 3: explicit and omitted -> `IS NULL`; `is_(None)` 2/2, `is_not(None)` 1/1 |
| M5 dim/finite enforced | FIXED | Check 3: 64/385/0-d, NaN, +/-inf -> `ValueError` (wrapped in `StatementError`); list and ndarray bit-exact |
| M6 poisoned cache | PARTIALLY FIXED, BLOCKING | Check 5: `str` blob of length 4k crashes (`TypeError`); on a fresh CachedEmbedder (the production path) a single wrong-size blob returns (1, 2) / (1, 768) / (1, 192) and is never healed |
| M7 test fixtures | FIXED | Check 6: committed rows visible through a real `Depends(get_session)` route; no leak across tests in any order; `fake_embedder_384` correct and deterministic across hash seeds |

### Blocking

| # | Where | Problem | Concrete fix |
|---|---|---|---|
| M6 (remainder) | api/services/embedding.py:30, :34, :52-56, :85 | (a) `mget` returning a `str` whose length is a multiple of 4 -> `np.frombuffer` raises `TypeError`, which neither `except ValueError` nor `_REDIS_ERRORS` catches, so `encode` crashes. (b) `get_embedder()` builds a fresh CachedEmbedder every call, so `_dim` is None and the "most common width" heuristic trusts a lone wrong-size blob: `encode(["x"])` returns shape (1, 2)/(1, 768)/(1, 192), makes no inner call and leaves the key poisoned. The M5 check then rejects every later DB write for that text. (c) NaN blobs of the right size are served as hits and never healed (same permanent M5 rejection) | `__init__(..., dim: int \| None = None)` with `self._dim = dim`; `get_embedder()` passes `dim=EMBEDDING_DIM` from `api.vector`; guard `isinstance(b, (bytes, bytearray, memoryview)) and len(b) > 0 and len(b) % 4 == 0`; after decoding, treat `not np.isfinite(vec).all()` as a miss. Verified on a patched copy (`scratchpad/r_embedding_fixed.py`, `scratchpad/r_m6_fixcheck.py`): 42/42 cases correct, healed, 1 mget + 1 execute. Add tests for a fresh single-text 8-byte key and a `"abcd" * 384` str value |
| B1 (new) | api/worker.py:16-31 (no worker hook) | `celery -A api.worker.celery_app worker` (the plan's README command, plan line 173) never calls `configure_celery()`: broker `amqp://guest@localhost:5672//`, results `disabled://`, `Cannot connect to amqp://...` loop. The API enqueues to Redis and the worker never consumes, so Tasks 5/6 tasks never run outside eager tests | Add `from celery.signals import celeryd_init` and `@celeryd_init.connect def _configure_worker(**_): configure_celery()` after line 27. Verified with `scratchpad/r_celery/r_fixmod.py`: the worker banner shows `transport: memory://` / `redis://...` and the task list, and reaches `ready`. Add a test that sends `celeryd_init` after setting `REDIS_URL=redis://example:6379/2` and asserts `celery_app.conf.broker_url` |

### Non-blocking (this recheck)

R1 `cosine_distance` compiles on sqlite too, so it must not be used on the SQLite path (Task 7). R2 a 384-char
digit string passes the vector check. R3 `celery_app.backend` stays cached across `configure_celery()` calls.
R4 the mixed-width fallback never heals majority-poisoned keys and calls the inner twice. R5 StaticPool makes
flushed-but-uncommitted test rows visible to the app. R6 test_models.py:97-101 resets the engine under a live
`session` fixture. R7 the in-repo visibility test does not hit a route. Non-blocking notes N1-N20 from the
first verdict still apply except N15 (resolved) and the M7-related Redis note in Check 7 of the first verdict
(resolved by `REDIS_URL=fakeredis://`).

Not verified (no Docker): live PostgreSQL 16 + pgvector (`pytest -m db` with `TEST_DATABASE_URL`) and a worker
against a real Redis.
