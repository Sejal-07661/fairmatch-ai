# M2 Final Judge Report (Milestone 2: database and API)

Date: 2026-11-03. Judge is read-only on source. Scope: Tasks 1-6 committed (HEAD 2b43628), Task 7 uncommitted
(`api/routers/search.py`, schema additions, `tests/api/test_end_to_end.py`, `tests/api/test_search_pg.py`,
README, `include_router` in `api/main.py`). Env: Python 3.13.5, SQLAlchemy 2.1.1, psycopg 3.3.7, pgvector 0.5.1,
FastAPI 0.141.1, Starlette 1.7.0, Celery 5.6.3, Alembic 1.20.0, ruff 0.17.3. Docker/PostgreSQL unavailable.

VERDICT: (pending, written at the end)

## Progress log (written incrementally)

### Check 1 (partial): lint and protected files
- `python -m ruff check .` -> "All checks passed!" (exit 0).
- `git diff HEAD --stat` -> only `README.md` (+71/-3), `api/main.py` (+2/-1), `api/schemas.py` (+8). Untracked:
  `api/routers/search.py`, `tests/api/test_end_to_end.py`, `tests/api/test_search_pg.py`, task-7 report.
- `git diff HEAD --stat -- core requirements.txt pyproject.toml api/db.py api/models.py api/vector.py api/security.py api/deps.py migrations` -> empty. Protected files unchanged.
- Note: `pyproject.toml` unchanged, which the plan permitted ("if needed").

### Check 2 (partial): PostgreSQL branch rendered offline
Built the statement through the real `similar_candidates()` with a fake session whose `bind.dialect.name ==
"postgresql"` and whose `execute()` captures the statement (scratch `probe_pg_render.py`), then compiled with
`sqlalchemy.dialects.postgresql.psycopg`:

```
SELECT candidates.id, candidates.embedding <=> %(embedding_1)s AS anon_1
FROM candidates
WHERE candidates.embedding IS NOT NULL ORDER BY candidates.embedding <=> %(embedding_1)s, candidates.id
 LIMIT %(param_1)s::INTEGER
```
- `<=>` (cosine distance) used; similarity is `1 - distance` in Python (search.py:39); `IS NOT NULL` filter;
  deterministic `ORDER BY distance, id`; `LIMIT` bound as `%(param_1)s::INTEGER`; the query vector is bound
  (`embedding_1`), processed by `EmbeddingType -> VECTOR.bind_processor` into the text literal `'[0.5,...]'`
  (psycopg3 sends str as `unknown`, which PostgreSQL resolves to `vector` for `vector <=> unknown`). No string
  interpolation of user input anywhere (the only user inputs are the path id, bound by `session.get`, and `limit`).
- Post-processing of PG rows: NaN distance (zero vector) and NULL distance map to similarity 0.0, ties re-sorted by
  lower id, 6 decimals: `[(3,0.1),(1,0.1),(2,nan),(4,None),(5,1.9)]` -> ids `1,3,2,4,5` with sims `0.9,0.9,0,0,-0.9`.
- psycopg3 adapter: pgvector 0.5.1 `VECTOR.bind_processor` emits the text form and `result_processor` parses the text
  form, so no `register_vector` is needed (and must NOT be added: with `register_vector`, psycopg returns numpy arrays
  and `Vector._from_db` would call `value[1:-1].split(',')` on an ndarray). Round trip list -> `'[0.25,...]'` (1921
  chars) -> list[384] works; NaN and wrong-dim values are rejected in `process_bind_param` before the driver.
- INSERT compiles to `... %(embedding)s` with the embedding processed to the text literal; column DDL `VECTOR(384)`.
