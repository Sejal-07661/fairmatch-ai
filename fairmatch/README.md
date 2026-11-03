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
| Backend API (FastAPI) | Planned next |
| Frontend Dashboard (React) | Planned next |

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

## Next steps

- Wrap all of this in a FastAPI backend with upload endpoints
- Build a simple React dashboard so this can be used without editing code
