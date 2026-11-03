# M2 Judge: Task 5 (candidates and opportunities endpoints)

Judge date: 2026-11-03. Read-only review of the uncommitted Task 5 work against
`docs/superpowers/plans/2026-11-03-milestone-2-database-and-api.md` (Global Constraints,
Review Focus, Task 5) and the design spec. Scratch probes live under the session scratchpad
(`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\`).

VERDICT: **PASS_WITH_FIXES**, 3 blocking issues (B1 temp-file leak of uploaded resumes, B2 NUL -> 500 on PostgreSQL, B3 unbounded ints / NaN -> 500). Details at the end.

## Check 1: suite, lint, protected files

- `python -m pytest -m "not slow and not llm and not db" -q` -> **210 passed, 3 deselected**, 1 warning
  (PyMuPDF `fitz` FutureWarning, third party) in 70 s.
- `python -m ruff check .` -> **All checks passed!**
- Task 5 + auth + cache tests alone: `tests/api/test_candidates.py tests/api/test_opportunities.py
  tests/api/test_auth.py tests/api/test_embedding_cache.py` -> 73 passed.
- `git diff HEAD --stat -- core requirements.txt pyproject.toml api/db.py api/models.py api/vector.py
  api/security.py api/deps.py api/routers/auth.py api/services/embedding.py migrations
  tests/api/conftest.py` -> empty (all protected files unchanged).
- Changed tracked files are exactly `api/main.py` (+2 include_router, import), `api/schemas.py`
  (appended), `api/worker.py` (appended `embed_profile`). New files are exactly the five the plan
  lists plus the task report. Nothing else touched.

Result: PASS.

## Check 2: interfaces vs plan Task 5

Probe `p2_interfaces.py` (TestClient on `create_app()`, OpenAPI dump + live calls): 34/34 OK.

| Plan item | Observed | OK |
|---|---|---|
| `POST /candidates` candidate or admin, multipart `name` + `resume_text` xor file `resume`, 201 `CandidateOut` | `CandidateUser = require_role("candidate","admin")`, multipart body schema `{name (req), resume_text?, resume?}`, 201 | yes |
| `GET /candidates/me` (candidate) | allows candidate **and admin** (admin without profile -> 404) | yes (see note N1) |
| `GET /candidates`, `GET /candidates/{id}` admin only | candidate -> 403 (also for its own id), admin 200, unknown id 404 | yes |
| `PUT/GET /candidates/{id}/demographics` admin only, `{group_label}` non-empty <= 64 | admin-only, 200 `{candidate_id, group_label}`, strip + 1..64 | yes |
| `POST /opportunities` admin; `capacity>=1`, `min_experience_years>=0`, `min_education_level 0..4` | OpenAPI: `minimum 1`, `minimum 0`, `0..4`; 201 | yes (no upper bound on capacity, see check 8) |
| `GET /opportunities`, `GET /opportunities/{id}` any authenticated user | candidate 200, unknown 404 | yes |
| `CandidateOut(id, name, skills, experience_years, education_level, used_fallback)` | exactly these 6 fields, in order | yes |
| `OpportunityIn`, `OpportunityOut`, `DemographicsIn`, `DemographicsOut` | present; `OpportunityOut` = id, title, posting_text, required_skills, capacity, min_experience_years, min_education_level | yes |
| `embed_profile(kind: str, row_id: int) -> None` Celery task, `.delay` after commit | signature `(kind: str, row_id: int) -> None`, task name `api.embed_profile`; `.delay` after `session.commit()` in both POSTs | yes |
| `create_candidate_profile(session, user, name, text) -> Candidate`, ValueError on blank | signature matches; `"   "` -> `ValueError("resume text must not be empty")` | yes |
| `create_opportunity(session, payload) -> Opportunity` | signature matches | yes |
| Pagination `limit` 1..100 default 50, `offset >= 0` (both lists) | OpenAPI `minimum 1 maximum 100 default 50`, `offset minimum 0`; limit 0/101/abc and offset -1 -> 422; 61 rows: default returns 50, limit=100 returns 61, offset=60 returns 1 | yes |

Notes from this check:
- N1 `GET /candidates/me` accepts admin too (plan says "(candidate)"). Harmless and consistent with admins being
  allowed to `POST /candidates`; document, do not change.
- N2 `create_candidate_profile` / `create_opportunity` only `session.add()` the row; they do not flush or commit
  (probe `p2b_unflushed.py`: `row.id is None` on return). The docstring says so and the routers commit. Task 6/7
  tests that seed through these services must `session.commit()` (StaticPool shared SQLite) before using `.id`.
- N3 OpenAPI lists only 2xx/422 responses for these routes (401/403/404/409 are not declared via `responses=`).
  Cosmetic.

Result: PASS.

## Check 3: privacy (most important)

Probe `p3_privacy.py`: candidates A and B (each with a profile), one admin; admin sets
`SECRET_LABEL_A` / `SECRET_LABEL_B`; root logger captured at DEBUG for the whole run. **59/59 OK.**

- A against B and against admin-only routes, every body scanned for `SECRET_LABEL`, B's name, B's resume
  marker, `java`, `group`, `demograph`: `GET /candidates/{B}`, `GET /candidates/{B}/demographics`,
  `GET /candidates/{A}/demographics` (own), `PUT` demographics for B and for A (valid, blank, int body),
  `GET /candidates`, `GET /candidates?limit=0`, `GET /candidates?limit=100&offset=0`, `GET /candidates/{A}`
  (own id), `GET /candidates/99999`, `/candidates/99999/demographics`, `/candidates/abc`,
  `/candidates/abc/demographics` -> all **403 `{"detail":"Forbidden"}`**, no leak. DELETE/PATCH -> 405.
  Malformed JSON to `PUT /candidates/{B}/demographics` -> 422 JSON-decode error echoing only A's own bytes
  (FastAPI parses the body before running dependencies; no stored data involved).
- No existence oracle: A gets byte-identical 403 for B's id and for a missing id (role check runs before
  the lookup, and before query/path validation, e.g. `limit=0` and `abc` also give 403).
- `/candidates/me` returns only the caller's own row (A gets A, B gets B); A's 201 and 409 bodies contain
  no label (`409 {"detail":"Profile already exists"}`).
- Injection: an extra form field `group_label=INJECTED_LABEL` on `POST /candidates` is ignored; the
  demographics table holds only the admin-set rows.
- `CandidateOut` responses (also for admin: list, by id) never contain `group`/`demograph`/label text.
- OpenAPI: models referenced by every candidate-facing operation (`Body_create_candidate_candidates_post`,
  `CandidateOut`, `HTTPValidationError`, `OpportunityIn`, `OpportunityOut`) contain no `group`/`demograph`
  key. `DemographicsIn/Out` appear only on the two admin-only routes.
- `group_label` validation (admin): `""`, `"   "`, `"\n\t"`, 65 chars, 65 x `é`, `5`, `null`, `["a"]`,
  `{"a":1}`, `true`, missing -> 422; 64 chars, 64 x `é`, `" " + 64 chars + " "` (stripped to 64) -> 200;
  extra keys ignored; stored value is the stripped string. The 422 echoes the rejected input, but only to
  the admin who sent it.
- Admin `PUT /candidates/99999/demographics` -> 404 `Candidate not found` and **no orphan row** (the
  `_get_or_404` pre-check matters because SQLite does not enforce the FK). `GET` -> 404.
- Unauthenticated demographics GET/PUT, list, by id -> 401.
- Embed task / logs / exceptions: `embed_profile` reads only `resume_text` / `posting_text` (source contains no
  `Demograph`/`group`); after a successful and a failing embed run (`RuntimeError("model down")`), the captured
  DEBUG log (7.8 KB) contains neither label nor the injected value; the failure log line is
  `embedding failed for candidate <id>` (kind + id only).

Result: PASS. No privacy defect found.

## Check 4: upload hardening

Probe `p4_upload.py` (34 file cases + field cases, `tempfile.tempdir` redirected to a dedicated empty dir so
every `TemporaryDirectory` and Starlette spool file lands there): 47/50 OK. The 3 non-OK items are analysed below
(one is my wrong expectation, one is a test-harness artifact, one is a real defect).

Read pattern (code, `api/routers/candidates.py:32-49`): suffix allow-list first, then
`upload.file.read(MAX_UPLOAD_BYTES + 1)`, a single bounded read, so the handler never holds more than 5 MiB + 1
bytes; the size check runs before anything is written or parsed. Starlette 1.7 has already received the whole
multipart body and spooled the file part (`SpooledTemporaryFile(max_size=1 MiB)`, the rest goes to disk), so
memory stays bounded, but **disk per request is not** (a 40 MiB upload is fully spooled before the 422). That is a
framework property; see note N5.

| Case | Result |
|---|---|
| 5 MiB + 1 byte `.txt` / `.pdf`; chunked (generator body, no Content-Length) 6 MiB multipart; 40 MiB `.pdf` | 422 `File too large (max 5 MiB)`, nothing persisted |
| exactly 5 MiB `.txt` | 422 `Resume text exceeds 20000 characters` |
| `.exe`, `.png`, no suffix, `resume.pdf.exe`, `.md` (core accepts it, API must not), dotfile `.txt`, `"r.txt "` | 422 `Unsupported file type; use .pdf, .docx or .txt` |
| `RESUME.PDF` (real PDF), `R.TXT`, `resume.exe.pdf` (real PDF) | 201 (suffix lower-cased; last suffix decides) |
| PDF that is plain text, truncated DOCX, zip that is not a DOCX, DOCX that is text, PDF bytes named `.docx` | 422 `Could not parse file as .pdf/.docx`, nothing persisted |
| DOCX bytes named `.pdf` | 201: PyMuPDF sniffs content and opens Office files, text extracted correctly. My expectation was wrong; harmless |
| PDF with a blank page (no text) | 422 `Resume text is empty` |
| zero-byte `.txt` / `.pdf` | 422 `File is empty`; whitespace-only `.txt` -> 422 `Resume text is empty` |
| non-UTF-8, Latin-1, UTF-16 `.txt` | 422 `Text file is not valid UTF-8`; UTF-8 with BOM -> 201 |
| `.txt` with a NUL byte; `resume_text`/`name` with NUL | **201 on SQLite, 500 on PostgreSQL** (blocking B2, below) |
| unicode filename `résumé_简历.txt` | 201 |
| `../x.txt`, `..\..\x.txt`, `C:\Windows\x.txt` | 201. The client filename is used only for its suffix; the file is always written as `<tmpdir>/resume<suffix>`; no `x.txt` appears outside the temp dir |
| both `resume_text` and file; neither; `resume_text=""` alone | 422 `Provide exactly one of resume_text or resume file` |
| `resume_text=""` **plus** a file | 201 from the file (FastAPI turns an empty optional form field into `None`). Friendly for HTML forms; document |
| `resume` sent as a plain string field | 422 (`Expected UploadFile`) |
| `name` `"   "`, 256 chars -> 422 `name must be 1-255 characters`; `name` `""`/missing, JSON body instead of form -> 422 (FastAPI list detail) |
| `resume_text` 20000 chars -> 201; 20001 -> 422 `Resume text exceeds 20000 characters`; same cap applies to file-extracted text (20000 -> 201, 20001 -> 422) |
| `resume_text` > 1 MiB form field | 400 `{"detail":"Field exceeded maximum size of 1024KB."}` (Starlette `max_part_size`), JSON shape kept |

**B1 (blocking): leaked temp directories containing the uploaded resume after some parse failures.** After the run
the temp dir held two directories: `tmpmjcbzyg5/resume.docx` (the "zip but not a DOCX" upload) and
`tmpsmgez75u/resume.pdf` (the 16-byte "PDF that is text" upload). Reproduced in isolation (`p4c_templeak.py`)
by calling `_extract_text` directly: zip-not-docx and text-as-pdf leak 1 directory each; truncated DOCX and bad UTF-8
do not. Cause (`candidates.py:41-49`): the `raise _unprocessable(...) from None` runs **inside** the
`with TemporaryDirectory(...)` block. `from None` only hides the context; `__context__` still holds the
parser exception, whose traceback frames keep python-docx's / PyMuPDF's file handle open while `__exit__` runs.
Windows cannot delete an open file, and `ignore_cleanup_errors=True` hides the failure, so the candidate's file stays
in `%TEMP%` for good. (On Linux the unlink succeeds, but the fd stays open until the exception is garbage-collected.)
Fix (checked in scratch, all 4 cases leave 0 entries): record the message in the `except` blocks, let the `with` block
exit, then raise afterwards; drop `ignore_cleanup_errors=True` so a future leak surfaces instead of hiding:
```python
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"resume{suffix}"
        path.write_bytes(data)
        error = None
        try:
            return read_resume_file(path)
        except UnicodeDecodeError:
            error = "Text file is not valid UTF-8"
        except Exception:  # noqa: BLE001 - any parser failure is a 422
            error = f"Could not parse file as {suffix}"
    raise _unprocessable(error)
```
Also add a regression test: point `tempfile.tempdir` at a `tmp_path` sub-dir, post the zip-not-docx and the
text-as-pdf files, and assert the dir is empty.

**B2 (blocking): NUL characters reach the database, so PostgreSQL returns 500.** psycopg 3.3.7 refuses NUL
in text parameters before it sends anything (`StrDumper(str).dump("a\x00b")` -> `psycopg.DataError: PostgreSQL text
fields cannot contain NUL (0x00) bytes`). SQLite stores it (probe: the row with `"python\x00sql"` resume text was
saved as id 6). Probe `p4d_nul_pg_sim.py` reproduces PostgreSQL's behaviour on SQLite with a `before_cursor_execute`
hook that runs the same psycopg dumper. A NUL in `resume_text`, in a `.txt` upload, in `name`, in `posting_text` or in `title` gives
**500 `Internal Server Error` (plain text, not `{"detail"}`)** each time. The routers catch only `IntegrityError`.
PostgreSQL is the target database (spec section 6), and any candidate can trigger this. Fix: reject NUL up front
with a 422. In `candidates.py` after computing `text`: `if "\x00" in text or "\x00" in name: raise
_unprocessable("Text must not contain NUL characters")` (or strip `\x00` from extracted file text, since PDF/DOCX
extraction can emit it); in `schemas.py` add the same check to the `OpportunityIn` `title`/`posting_text`
validators and to `DemographicsIn._label`. Add a test for each.

Concurrency (`p4b_concurrency.py`): 12 distinct users uploading at once on the conftest engine (`sqlite://`,
**StaticPool = one sqlite3 connection shared by every thread**) give 500s (`InterfaceError: bad parameter or other API
misuse`, `MultipleResultsFound`, `Could not refresh instance`), spurious 401s, and **duplicate ids returned to
different users** (e.g. `201 ids [2, 4, 4, 4, 5, 8, 8]`) in all 3 runs. The same probe on a file SQLite database
(QueuePool, one connection per session) gives **12/12 201 with distinct ids, rows = ids** in both runs. So this is an
artifact of the Task 2 in-memory StaticPool harness, not of Task 5 code. PostgreSQL uses a real pool. Same user x4
concurrently on StaticPool: exactly one 201 and three 409. See note N6 (Task 6 must not test concurrency on `sqlite://`).

Result: FAIL on this check (B1, B2); everything else in it passes.

## Check 5: duplicate profile / race / `.delay` timing

Probe `p5_race.py`, run twice: on a file SQLite DB (QueuePool; the spy's own session only sees **committed** rows) and on
the conftest `sqlite://` StaticPool. **15/15 OK on both.** `embed_profile` in both routers is replaced by a spy
that records `(kind, id, row_visible_to_a_separate_session)` and then forwards to the real task.

- First profile: 201, spy `[('candidate', 1, True)]`, so `.delay` runs once and only after the commit is visible.
- Second profile, same user: 409 `{"detail":"Profile already exists"}` from the pre-check; spy not called.
- IntegrityError path: `api.routers.candidates.select` monkeypatched so the pre-check query gets `.where(false())`
  (it finds nothing). The insert then hits `UNIQUE(candidates.user_id)` at `session.commit()`, which goes to `rollback()`
  and a 409 with the same body; spy not called.
- After the race: `GET /candidates/me` is byte-identical to the original 201 body. The DB has exactly one row for the
  user, with the original name and resume text. The next request (another user) gets 201 and a post-commit
  `.delay`, so neither the session nor the pooled connection is poisoned.
- 422 paths (blank text, `.exe`, unparseable `.pdf`) and `POST /opportunities` with `capacity 0`: spy not called.
  `POST /opportunities` 201: one post-commit `.delay('opportunity', id)`.
- Extra (not in the plan): if `.delay` itself raises after the commit (broker down, simulated with
  `ConnectionError`), `POST /candidates` returns **500 `Internal Server Error`, but the row was committed**, and the
  client's retry gets 409. Same mechanism in eager mode when the task raises after its own commit (check 6). See N4.

Result: PASS.

## Check 6: `embed_profile`

Probe `p6_embed.py` (eager mode, `task_eager_propagates=True`): 11/11 OK.

- Stores a 384-length `list[float]` equal to the embedder output, for both `candidate` and `opportunity`. The task
  returns `None`.
- **Idempotency is by overwrite, not skip.** A second run calls the embedder again (1 call, counted) and writes
  the same vector. The plan says "idempotent", and repeat runs end in the same state, so this matches. It does
  re-embed: cheap through the Redis cache, and it refreshes the vector if the text changes. If "skip if already
  set" was the intent, add `if row.embedding is not None: return`, but then text edits would never re-embed.
  Document either way.
- Row gone (`row_id=424242`): no-op, returns `None`. `row_id="1"` (str) also works.
- Unknown kind `"bogus"`: returns `None` and logs `WARNING embed_profile: unknown kind 'bogus'`; it does not raise.
  Clear enough for a background task; document.
- `get_embedder()` raises, or `encode()` raises: embedding stays NULL; `ERROR embedding failed for candidate <id>`
  is logged with a traceback (kind and id only, no text and no labels); no exception reaches the caller.
- Empty resume text (not reachable through the API, which rejects blank text): no crash. It stores a **zero
  vector** (norm 0.0) with both the fake and the real `CachedEmbedder` normalisation. A zero vector has an undefined
  cosine distance in pgvector, so Task 7 should skip or guard rows like this. Note N7.
- Invalid vector from the embedder (10-d, or NaN): `EmbeddingType.process_bind_param` raises at the task's
  `session.commit()`, which is **outside** the task's `try`, so the task raises `StatementError` (embedding stays NULL).
  In eager mode this reaches the request: `POST /candidates` returns **500 after the profile was committed**. The
  production embedder always returns 384 finite floats, so this is an edge case. See N4.

Result: PASS (notes N4, N7).

## Check 7: parsing integration

Probe `p7_parsing.py`: 16/16 OK.

- `services/profiles.py:13` calls `parse_candidate(id=str(user.id), name=name, text=text, llm=get_llm_client())`, and
  `create_opportunity` calls `parse_posting(..., llm=get_llm_client())`. The client is looked up on every call, not
  cached at import. Without `OPENAI_API_KEY`, `get_llm_client()` is `None` and the profile has `used_fallback: true`.
- `api.services.profiles.get_llm_client` monkeypatched to `FakeLLMClient(raises=True)`: 201 with
  `used_fallback: true` and spaCy skills `["python","sql"]`. For opportunities: 201 with spaCy `required_skills`.
- A working fake LLM gives `used_fallback: false`, and skills are canonicalised through the taxonomy
  (`["Python","Structured Query Language","nonsense-skill"]` -> `["python"]`, an M1 taxonomy property). Clamping holds
  end to end: `experience_years -3 -> 0`, `education_level 9 -> 4`, `-2 -> 0`. Malformed LLM output (`"5"`, `True`,
  a skills string, non-str skills, missing keys) is rejected by core and gives `used_fallback: true` with the regex
  values.
- Every stored row: `skills` is a `list[str]`, `education_level` an int in 0..4, `experience_years >= 0`. Experience is
  stored and returned as a float (`5.0`), as the Task 2 model defines.
- Opportunities: `required_skills` comes from `parse_posting`; `min_experience_years` / `min_education_level` come from
  the admin payload, and the parsed values are deliberately ignored (`{"experience_years": 9, "education_level": 4}`
  from the LLM did not override payload `1` / `2`).

Result: PASS.

## Check 8: opportunities validation, roles, auth

Probe `p8_opps.py`: 49/51 OK. The cause probes are `p8b_causes.py` (strict client, `raise_server_exceptions=True`) and `p8c_nan_persist.py`.

Bounds that hold, with nothing persisted on each 422:
- `capacity` `0`, `-1`, `2.5`, `"abc"`, `null`, `[1]` -> 422; `1` -> 201.
- `title` `""`, `"   "`, 201 chars, `5`, `null` -> 422; 200 chars and `"  " + 200 + "  "` (stripped) -> 201.
- `posting_text` `""`, `" \n "`, 20001 -> 422; 20000 -> 201.
- `min_education_level` `5`, `-1`, `2.5` -> 422; `0`, `4` -> 201.
- `min_experience_years` `-1`, `-0.0001` -> 422; `0`, `1.5` -> 201.
- Each of the 5 fields missing -> 422.

Pydantic lax coercion accepts `capacity "2"`, `2.0` and `true` (stored as 1). That is harmless; use `strict=True` if unwanted.

Other behaviour:
- `required_skills` comes from `parse_posting`: `"Looking for python and sql skills."` -> `["python","sql"]`.
- Title is stored stripped.
- Candidate `POST /opportunities` -> 403. Candidate `GET` list and by id -> 200. `/opportunities/abc` -> 422; `/0` and `/-1` -> 404.
- Auth on all 9 Task 5 endpoints -> **401 everywhere** (`{"detail":"Not authenticated"}` / `{"detail":"Invalid token"}`). Tokens tested: none, expired (`exp` 5 min in the past), wrong secret, `alg: none`, garbage, `Basic` scheme, and a valid token whose user was deleted.

**B3 (blocking): unbounded numeric input reaches SQLite/PostgreSQL or the JSON encoder and returns 500 (plain text `Internal Server Error`, which breaks the Global Constraint error shape).**
- (a) `OpportunityIn.capacity` has no upper bound (`schemas.py:77`). `2**63` and `10**20` -> 500 (`OverflowError: Python int too large to convert to SQLite INTEGER`). `2**31` -> 201 on SQLite, but the column is `sa.Integer` (int4) in `migrations/versions/0001_initial.py:53`, so PostgreSQL fails with "integer out of range" -> 500. `10**9` -> 201, after which Task 6's core seat expansion (`core/allocation.py:42`, `[j ... for _ in range(capacity)]`) tries to build a list of a billion entries in the worker.
- (b) `{id}` path parameters are unbounded (`candidates.py:110,115,130`, `opportunities.py:41`). `GET /opportunities/{2**70}` **as a candidate**, and admin `GET/PUT /candidates/{2**70}[/demographics]` -> 500 (`OverflowError`) on SQLite, the default `DATABASE_URL`. `2**63-1` -> 404.
- (c) JSON `NaN` for `min_experience_years` gives 500, but nothing is persisted. Pydantic rejects it, and then FastAPI's default 422 body echoes `"input": NaN`, which Starlette's `JSONResponse` (`allow_nan=False`) cannot render: `ValueError: Out of range float values are not JSON compliant: nan`. `Infinity` / `1e999` are **accepted**: 201, stored as `inf`, and returned as `"min_experience_years": null`, which breaks `OpportunityOut`'s float contract.

Fix:
- `capacity: int = Field(ge=1, le=10_000)`. Pick a documented bound; it also protects Task 6's seat expansion.
- `min_experience_years: float = Field(ge=0, le=60, allow_inf_nan=False)`.
- `candidate_id: Annotated[int, Path(ge=1, le=2_147_483_647)]` (same for `opportunity_id`) on every `{id}` route.
- In `main.py`, an `@app.exception_handler(RequestValidationError)` that returns `{"detail": "<loc>: <msg>; ..."}`
  as a **string** without echoing `input`. This removes the NaN render crash and also brings all 422s in line with the
  Global Constraint `{"detail": str}` (see check 9).
- Add tests for capacity 10_001, 2**63, path id 2**70, NaN and Infinity.

Result: FAIL on this check (B3); everything else passes.

## Check 9: error shape fuzz

Probe `p9_fuzz.py`: **50 malformed requests**. They cover wrong content types (form to a JSON route, `text/plain`,
`application/xml`, an empty body, JSON to the multipart route, a broken multipart boundary), bad JSON (`{bad`, `[]`,
`null`, `"str"`, invalid UTF-8, a truncated object, 5000-deep nesting), huge numbers (a 5000-digit `capacity`,
`10**30`, `10**400`, 50-digit `limit`/`offset`/path ids, `limit=1e3`), missing fields, wrong methods (DELETE/PUT/PATCH/POST on
every resource), unknown paths, duplicates and an empty bearer.

- **Tracebacks in bodies: 0.** No body contains `Traceback` or `File "`.
- **500s: 3**, all plain-text `Internal Server Error`:
  - `GET /opportunities?offset=<50 digits>`, which is **candidate-reachable**: `offset` has `ge=0` but no `le`, and the value overflows SQLite INTEGER.
  - `GET /opportunities/<30 digits>`.
  - `GET /candidates/<30 digits>` (admin).

  All three are B3 (unbounded ints). Add `offset: Query(ge=0, le=1_000_000)` (or `le=2**31-1`) to the B3 fix.
- Every other non-2xx is JSON with exactly the key `detail`: 400 multipart/body-parse errors carry a string,
  401/403/404/405/409 and the handler-raised 422s carry a string. **25 of 47 non-2xx carry a list `detail`**
  (FastAPI's default `RequestValidationError` body). The Global Constraint says `{"detail": str}`. This dates back to
  Task 1/3 (auth's `RegisterIn` 422s have the same shape) and earlier judges did not flag it. The
  `RequestValidationError` handler in the B3 fix resolves it for every route; see N8.
- `GET /opportunities/` follows a 307 redirect to `/opportunities` and returns 200. `GET /candidates/me/demographics`
  -> 403, because the role check runs before `"me"` is parsed as an int.

Result: FAIL (the 3 × 500 belong to B3); the shape is otherwise consistent.

## Check 10: regressions, dead code, plan contradictions

- Regressions: none. Full fast suite 210 passed. `test_auth.py` + `test_embedding_cache.py` + Task 5 tests
  73 passed. Protected files are byte-identical to HEAD (check 1). There are no new dependencies (`pymupdf` and
  `python-docx` were already in `requirements.txt` from M1).
- Plan test inventory: all 13 candidate test names and all 6 opportunity test names in plan Task 5 exist. There are
  38 test items (the task report's "38 new tests" is accurate), plus extras (`test_bad_files_422_nothing_persisted` x8,
  `test_admin_can_create_profile`, `test_candidate_cannot_read_other_candidate_403`,
  `test_embed_profile_survives_embedder_failure`, parametrized `test_invalid_422` x8).
- Route order is correct: `/candidates/me` is declared before `/candidates/{candidate_id}`.
- Global Constraints:
  - Sync `def` endpoints: yes.
  - Protected attributes admin-only: yes (check 3).
  - LLM fallback recorded: yes (check 7).
  - Only mainstream libraries: yes.
  - Error shape: violated by 500s (B2, B3) and list-shaped 422s (N8).
- **The repo's own suite leaks into `%TEMP%` on Windows** (evidence for B1). `C:\Users\Sejal\AppData\Local\Temp\tmp*\resume.pdf`
  held 5 directories containing `just plain text, not a pdf`, which is the
  `test_bad_files_422_nothing_persisted[file3]` payload, one per suite run (17:12 to 17:19). My `p5_race.py` probe added two
  more (`nope`), and I removed those. The 5 suite-made ones are left as evidence; delete them after the B1 fix.
- Dead or weak code:
  - The `create_candidate_profile` `ValueError` branch cannot be reached from the router, which rejects blank text
    first. The plan requires it; keep it.
  - `session.refresh(row)` after `.delay` (`candidates.py:79`, `opportunities.py:26`) is an extra query that the
    response does not need (neither Out model has `embedding`).
  - `import logging` and `log = getLogger` inside the task body. Style only.
  - `test_oversized_file_422` (`test_candidates.py:128-132`) cannot tell the 5 MiB check apart from the 20000-char
    cap, because its >5 MiB `.txt` payload would also fail the text cap. Assert `"too large" in r.json()["detail"]`
    (N9).

## Verdict

**VERDICT: PASS_WITH_FIXES. 3 blocking issues.**

The core of Task 5 is sound:
- Privacy (the most important check) holds with no leak in 59 probes.
- Interfaces match the plan exactly for Task 6.
- 409 handling covers both the pre-check and the IntegrityError race.
- `.delay` runs strictly after the commit.
- The LLM fallback and core clamping work end to end.
- The suite and lint are green, and no protected file changed.

The three blocking issues are small, local robustness defects. Each causes a 500 or leaves candidate data on disk.

### Blocking issues

1. **B1: temp directories holding uploaded resumes are never removed after some parse failures (Windows).**
   - Where: `fairmatch/api/routers/candidates.py:41-49`. The `raise ... from None` runs inside
     `with TemporaryDirectory(ignore_cleanup_errors=True)`.
   - Why: the parser exception, still attached as `__context__`, keeps PyMuPDF's / python-docx's file handle open while
     the directory is cleaned up, and `ignore_cleanup_errors=True` hides the failure.
   - Evidence: reproduced with a text-as-PDF upload and a zip-not-DOCX upload. The repo's own
     `test_bad_files_422_nothing_persisted[file3]` leaves `%TEMP%\tmp*\resume.pdf` behind on every run (5 present now).
   - Fix: store the message in the `except` blocks, leave the `with` block, then
     `raise _unprocessable(error)`; drop `ignore_cleanup_errors=True`. The code is in check 4 and was verified in
     scratch: 0 leaks across 4 cases.
   - Test: add one that redirects `tempfile.tempdir` to `tmp_path` and asserts the directory is empty after both bad
     uploads.
2. **B2: NUL characters give 500 on PostgreSQL.**
   - Where: `fairmatch/api/routers/candidates.py:60-72` (`name`, `resume_text`, extracted file text) and
     `fairmatch/api/schemas.py:81-98` and `:56-64` (`title`, `posting_text`, `group_label`).
   - Why: psycopg 3 raises `DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes`, and the routers only
     catch `IntegrityError`.
   - Evidence: simulated through the API with psycopg's own dumper; all 5 fields return 500.
   - Fix: reject with 422 (`"... must not contain NUL characters"`), or strip `\x00` from extracted file text, in the
     router and in the three validators. Add tests.
3. **B3: unbounded integers and non-finite floats give 500, or are accepted and break things later.**
   - Where:
     - `fairmatch/api/schemas.py:77` (`capacity`, no `le`). `2**63` gives 500 on SQLite; `>= 2**31` overflows
       PostgreSQL `INTEGER`; `10**9` is accepted and makes Task 6's seat expansion build a list of a billion entries.
     - `schemas.py:78` (`min_experience_years`). `Infinity` is stored and returned as `null`; `NaN` gives 500 because
       the default 422 body echoes `NaN` and cannot be JSON-encoded.
     - Path ids at `candidates.py:110,115,130` and `opportunities.py:41`, plus `offset` at `candidates.py:96` and
       `opportunities.py:35`. Values of 2**63 and above give 500 on SQLite; `GET /opportunities/{2**70}` and
       `?offset=<50 digits>` are reachable by any candidate.
   - Fix:
     - `capacity: int = Field(ge=1, le=10_000)`.
     - `min_experience_years: float = Field(ge=0, le=60, allow_inf_nan=False)`.
     - `Annotated[int, Path(ge=1, le=2_147_483_647)]` on every `{id}`.
     - `offset: Query(ge=0, le=2_147_483_647)`.
     - A `RequestValidationError` handler in `fairmatch/api/main.py` that returns `{"detail": "<loc>: <msg>; ..."}`
       as a string, without `input`. This also satisfies the Global Constraint `{"detail": str}` (N8).
   - Tests: add capacity 10_001 and `2**63`, path id `2**70`, NaN and Infinity.

### Non-blocking notes

- N1 `GET /candidates/me` also accepts admin (plan says candidate). Harmless; document.
- N2 `create_candidate_profile` / `create_opportunity` only `session.add()`; `.id` is `None` until the caller
  commits. Task 6/7 seeding must commit (shared StaticPool).
- N3 OpenAPI declares only 2xx/422 for these routes; add `responses=` for 401/403/404/409 if the docs matter.
- N4 Failures after the commit surface as 500 although the row was saved. Examples: `.delay` raising (broker down),
  or the eager task raising at its own commit (an invalid vector rejected by `EmbeddingType`). The client then gets
  409 on retry. Wrap `.delay(...)` in `try/except Exception: log.exception(...)` (the embedding can be re-queued
  later), and move the task's `session.commit()` inside its `try` with a rollback.
- N5 Starlette spools the whole multipart body to disk before the handler's bounded 5 MiB + 1 read, so memory is
  bounded but disk per request is not. Add a request-size limit at the reverse proxy (M4) or a Content-Length guard.
  Residual risk: a DOCX zip bomb under 5 MiB is fully decompressed by python-docx; acceptable for this scope.
- N6 The conftest `sqlite://` StaticPool shares one sqlite3 connection across threads. Concurrent requests corrupt
  each other there (500s, spurious 401s, duplicate ids returned to different users), while a file SQLite database is
  clean (12/12). Task 6's "two runs at once" test must not use real threads against `sqlite://`; use sequential
  re-delivery or a file DB.
- N7 Empty resume text, which the API cannot produce, would store a zero vector; Task 7 cosine search should guard
  against it.
- N8 FastAPI's default 422 `detail` is a list, not a string (pre-existing since Task 1/3). The B3 handler fixes it
  globally.
- N9 `test_oversized_file_422` should assert `"too large"` in `detail`; at the moment the 20000-char cap alone
  would make it pass.
- N10 `embed_profile` is idempotent by overwrite (it re-encodes every run, cheaply through the cache). Unknown kind:
  a warning log and `None`, no exception. Both are acceptable; document in the docstring.
- N11 Lax coercion accepts `capacity: true` / `"2"`; set `strict=True` on the field if unwanted.
- N12 `session.refresh(row)` after `.delay` is unnecessary for the response models.
