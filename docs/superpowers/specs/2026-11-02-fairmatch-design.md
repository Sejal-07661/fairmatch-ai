# FairMatch AI — Design Spec

Date: 2026-11-02 · Author: Sejal Somkuwar · Supervisor: Dr. Tanmoy Kanti Das (NIT Raipur)

## 1. Goal

A working, explainable, fairness-audited system that allocates candidates to
capacity-limited internships/jobs. Built for an MCA project: impressive, defensible in a
viva, and runnable with one command. Upgrades the existing Python prototype in
`fairmatch/` (parser, TF-IDF, scoring, Hungarian) rather than discarding it.

## 2. Principles

- **Only mainstream, widely adopted technologies.** No niche libraries.
- **Allocation is deterministic and auditable.** LLMs parse and narrate; they never decide.
- **Protected attributes (gender, category, etc.) are stored but never used in scoring.**
  They are used only by the fairness audit.
- **Each module has one purpose and a clear interface**, testable in isolation.
- **Prototype keeps working** during the upgrade (demo.py stays green until replaced).

## 3. Stack

| Layer | Choice |
|---|---|
| API | FastAPI (async), Pydantic v2, JWT (python-jose) with roles: candidate, admin |
| Jobs | Celery + Redis (embedding generation, allocation runs) |
| Database | PostgreSQL 16 + pgvector (HNSW index), SQLAlchemy 2.0, Alembic |
| Cache | Redis (embedding + score-matrix cache) |
| Parsing | PyMuPDF / python-docx (text), spaCy (NER, tokenisation), skill taxonomy (ESCO subset, seeded), OpenAI structured outputs (JSON schema) for extraction, with spaCy fallback when no API key |
| Embeddings | Sentence-Transformers (`BAAI/bge-small-en-v1.5`) |
| Scoring | Hybrid: semantic cosine + taxonomy-aware skill overlap + rule terms (experience, education); weights configurable |
| Allocation | SciPy `linear_sum_assignment` (Hungarian, seats expanded) and custom capacity-aware Gale-Shapley |
| Fairness | Fairlearn + custom metrics: selection-rate parity, disparate-impact ratio (4/5ths rule), per-group mean score |
| Explainability | Per-skill contribution breakdown (exact, from the score formula) + OpenAI-written plain-English summary grounded only in those numbers |
| Frontend | React 18 + TypeScript + Vite, TanStack Query, Tailwind CSS, Recharts |
| DevOps | Docker Compose (api, worker, postgres, redis, web), pytest, ruff, GitHub Actions |

OpenAI is the default LLM provider (widely used, matches existing experience); the client
sits behind a small interface so another provider can be swapped in.

## 4. Architecture

```
React dashboard  ->  FastAPI  ->  Celery worker
                        |             |
                        +-> PostgreSQL+pgvector <-+
                        +-> Redis (broker + cache)
Pipeline (pure Python package `fairmatch/core`):
 parse -> embed -> score matrix -> allocate (Hungarian | Gale-Shapley)
       -> explain -> fairness audit
```

`fairmatch/core` has no web or DB imports, so every stage is unit-testable with plain
data. The API and worker are thin layers that load data, call core, and persist results.

## 5. Modules and interfaces

| Module | Input -> Output |
|---|---|
| `core.parser` | text/file -> `ParsedProfile(skills, education, years_exp)` |
| `core.embeddings` | text -> vector (batched, cached) |
| `core.scoring` | candidates x postings -> score matrix + per-pair `ScoreBreakdown` |
| `core.allocation` | score matrix + seats + algorithm name -> `Allocation` |
| `core.explain` | `ScoreBreakdown` -> structured reasons + narrative |
| `core.fairness` | `Allocation` + group labels -> metrics report |
| `core.compare` | runs both algorithms -> total score, stability (blocking pairs), runtime, fairness |

## 6. Data model (PostgreSQL)

`users`, `candidates` (profile, skills JSONB, embedding vector, optional protected
attributes in a separate table `candidate_demographics`), `opportunities` (requirements,
seats, embedding vector), `allocation_runs` (algorithm, params, status, metrics),
`allocations` (run_id, candidate_id, opportunity_id, score, breakdown JSONB, explanation).

## 7. API (core endpoints)

`POST /auth/login`, `POST /candidates` (+resume upload), `POST /opportunities`,
`POST /runs` (algorithm: hungarian | gale_shapley | both) -> 202 + run id,
`GET /runs/{id}` (status, allocations, fairness, comparison), `GET /runs/{id}/explanations`.

## 8. Error handling

Unparseable resume -> 422 with reason; LLM failure -> automatic spaCy fallback, flagged in
the profile; run failure -> run status `failed` with message; seats = 0 or no candidates ->
validated up front.

## 9. Testing

pytest unit tests per core module (including seat-capacity never exceeded, Hungarian
optimality vs brute force on small cases, Gale-Shapley stability with zero blocking
pairs); API tests with a test Postgres container; frontend smoke test. CI runs ruff +
pytest on every push.

## 10. Milestones (each gets its own plan)

1. Core upgrade: embeddings, LLM parsing, hybrid scoring, Gale-Shapley, compare, fairness
2. Database + FastAPI + Celery + auth
3. Dashboard (upload, run, algorithm comparison, fairness view, explanations)
4. Docker Compose + CI + documentation

## 11. Out of scope

Real-time chat, payments, multi-tenant orgs, model fine-tuning, cloud deployment (Docker
only).
