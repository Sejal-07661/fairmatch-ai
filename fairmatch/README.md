# FairMatch AI — Working Prototype (Progress Milestone)

An AI-powered system that matches candidates to internships/jobs fairly,
using semantic similarity + skill matching + seat-constrained allocation.

## What is working right now

| Module | Status | File |
|---|---|---|
| Skill taxonomy (canonical names, related skills) | Done | `core/taxonomy.py`, `core/data/skills.json` |
| Resume/Posting parser (LLM first, spaCy fallback) | Done | `core/parser.py` |
| Embeddings (sentence-transformers) | Done | `core/embeddings.py` |
| Hybrid fit scoring (semantic, skills, experience, education) | Done | `core/scoring.py` |
| Allocation (Hungarian and Gale-Shapley) | Done | `core/allocation.py` |
| Algorithm comparison (total score, blocking pairs, runtime) | Done | `core/compare.py` |
| Explainability (grounded reasons, optional LLM narrative) | Done | `core/explain.py` |
| Fairness audit (selection rates, four-fifths rule) | Done | `core/fairness.py` |
| End-to-end pipeline | Done | `core/pipeline.py` |
| Backend API (FastAPI, PostgreSQL + pgvector, Celery) | Done | `api/` |
| Frontend Dashboard (React) | Done | `../frontend/` |

## How to run the demo

```bash
pip install -r requirements.txt
python demo.py
```

The first run downloads the embedding model once. Optionally set
`OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`) to use an LLM for parsing and narrative explanations;
without it the demo uses the spaCy fallback and deterministic explanations.

The demo runs 6 sample candidates against 5 postings and prints extracted
skills, the score table, both allocations side by side (total score, blocking
pairs, runtime), a fairness report per algorithm, and every explanation. Group
labels in the demo are assigned alternately and are demo-only.

Tests: `python -m pytest -m "not slow and not llm and not db" -q`; lint: `python -m ruff check .`

## Why the Hungarian Algorithm matters here

If we just gave every candidate their single best-scoring posting, two
candidates could want the same seat while another posting gets nobody. The
Hungarian Algorithm looks at the whole picture at once and resolves such
conflicts by maximising the total score under each posting's seat limit.
The demo runs Hungarian and Gale-Shapley side by side and compares their
total score, blocking pairs and runtime.

## Backend API

### Setup

```bash
pip install -r requirements.txt
docker compose -f docker-compose.dev.yml up -d      # PostgreSQL + pgvector, Redis
export JWT_SECRET=<long random string>
export DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch
export REDIS_URL=redis://localhost:6379/0
alembic upgrade head
python -m api.cli create-admin EMAIL PASSWORD
uvicorn api.main:create_app --factory
celery -A api.worker.celery_app worker               # separate terminal
celery -A api.worker.celery_app worker --pool=solo   # on Windows
```

Windows PowerShell form of the environment setup:

```powershell
$env:JWT_SECRET = "<long random string>"
$env:DATABASE_URL = "postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch"
$env:REDIS_URL = "redis://localhost:6379/0"
```

`JWT_SECRET` (non-blank) and `DATABASE_URL` must be set in the alembic step, the
API terminal and the worker terminal. Without `DATABASE_URL` everything falls
back to a local SQLite file, not the PostgreSQL container.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLAlchemy URL, e.g. `postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch` |
| `REDIS_URL` | Redis for the embedding cache and Celery broker. Default `redis://localhost:6379/0`; `fakeredis://` uses an in-memory fake (tests, no Redis needed) |
| `JWT_SECRET` | Required. Secret used to sign access tokens; the app refuses to start if it is unset or blank |
| `ACCESS_TOKEN_MINUTES` | Access token lifetime in minutes. Default 60 |
| `CELERY_EAGER` | Default `false`. `true` runs tasks inline in the API process, so no worker or broker is needed (tests, quick local dev) |
| `OPENAI_API_KEY` | Optional; enables LLM parsing and narratives |
| `OPENAI_MODEL` | Optional; default `gpt-4o-mini` |

### Endpoints

| Method and path | Role | Success | Errors |
|---|---|---|---|
| `GET /health` | none | 200 | |
| `POST /auth/register` | none | 201 | 409, 422 |
| `POST /auth/login` | none | 200 | 401, 422 |
| `POST /candidates` (resume text or file) | candidate or admin | 201 | 400, 401, 409, 422 |
| `GET /candidates/me` | candidate or admin | 200 | 401, 404 |
| `GET /candidates`, `GET /candidates/{id}` | admin | 200 | 401, 403, 404, 422 |
| `PUT/GET /candidates/{id}/demographics` | admin | 200 | 401, 403, 404, 422 |
| `POST /opportunities` | admin | 201 | 401, 403, 422 |
| `GET /opportunities`, `GET /opportunities/{id}` | any user | 200 | 401, 404, 422 |
| `GET /opportunities/{id}/similar-candidates?limit=10` (1..50) | admin | 200 | 401, 403, 404, 422 |
| `POST /runs` (`hungarian`, `gale_shapley`, `both`) | admin | 202 | 401, 403, 422, 503 |
| `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/explanations` | admin | 200 | 401, 403, 404, 422 |

Similarity search uses pgvector cosine distance on PostgreSQL and a Python
cosine computation elsewhere. It returns only `candidate_id` and `similarity`,
sorted by similarity descending (ties by lower id). Candidates or opportunities
without an embedding are omitted / give an empty list.

### Privacy rules

- Demographic group labels are admin-only and used only by the fairness audit.
  They are never part of scoring, explanations or candidate-facing responses.
- Candidates see only their own profile. Allocation runs and explanations are admin-only.
- Every non-2xx response has the shape `{"detail": "<message>"}`, including unhandled errors (500 `Internal server error`).

### Known limits

- Resume uploads are limited to 5 MiB; run a reverse proxy with a body-size limit in production.
- Opportunity capacity is at most 10000; a run requires candidates x seats <= 25,000,000.
- A run killed mid-way stays `running`, and a run that was never enqueued stays `pending`; there is no reclaim yet.
- The PostgreSQL path is verified offline only unless the `TEST_DATABASE_URL` tests were run.

### Tests

```bash
pytest -m "not slow and not llm and not db"
TEST_DATABASE_URL=postgresql+psycopg://fairmatch:fairmatch@localhost:5432/fairmatch pytest -m db
```

## Dashboard

A React dashboard lives in `../frontend/` (see its README).

- Install: `cd ../frontend && npm install`.
- Develop: start the API (`python -m uvicorn api.main:create_app --factory --port 8000`), then `npm run dev` (http://localhost:5173, proxies `/api` to the API). If port 8000 is used by another program, run the API on another port and start Vite with `VITE_API_TARGET=http://127.0.0.1:<port>`.
- Scripts: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run gen:api`, `npm run e2e`.
- Contract: `openapi.json` is a committed snapshot (`python scripts/export_openapi.py`, `--check` in pytest); the frontend types are generated from it.
- Roles: candidates see only their profile; admins manage opportunities and candidates, start runs and read results, fairness and explanations.
- The access token lives in `sessionStorage` only.
- End-to-end: `npm run e2e` starts this API on port 8765 with a temporary SQLite database prepared by `scripts/e2e_prepare.py`.
- Known limits: run status is polled; lists are paged 25 at a time (the API caps pages at 100).

## Next steps

- Harden for production: CSP and referrer policy at the serving proxy, route-level code splitting, an audit-trail view.
