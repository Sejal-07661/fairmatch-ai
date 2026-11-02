# FairMatch AI — Working Prototype (Progress Milestone)

An AI-powered system that matches candidates to internships/jobs fairly,
using semantic similarity + skill matching + seat-constrained allocation.

## What is working right now

| Module | Status | File |
|---|---|---|
| Resume/Posting Parser (skill extraction via NLP) | ✅ Done | `app/parser.py` |
| Embedding + Similarity Engine | ✅ Done | `app/embeddings.py` |
| Fit Scoring Engine | ✅ Done | `app/scoring.py` |
| Allocation Engine (Hungarian Algorithm) | ✅ Done | `app/allocation.py` |
| Explainability (why each match was made) | ✅ Done | built into `demo.py` output |
| Fairness Audit Module | ⏳ Planned next |
| Backend API (FastAPI) | ⏳ Planned next |
| Frontend Dashboard (React) | ⏳ Planned next |

## How to run the demo

```bash
pip install -r requirements.txt
python3 demo.py
```

This runs the full pipeline on 6 sample candidates and 5 sample internship
postings, and prints:
1. Extracted skills for every candidate/posting
2. The fit-score table (every candidate vs every posting)
3. The final allocation (who got which internship)
4. An explanation for every match (which skills matched, similarity score)

## Why the Hungarian Algorithm matters here

If we just gave every candidate their single best-scoring posting, two
candidates could end up wanting the same posting while another posting
gets nobody. The Hungarian Algorithm looks at the whole picture at once
and finds the best possible overall assignment given that each posting
only has limited seats. In our demo, this is visible directly: two
candidates (Aarav Sharma and Ishaan Gupta) both scored highest on the
same "Backend Developer Intern" posting -- the algorithm correctly
allocated the stronger match (Ishaan, 0.759) and left the other
unallocated for that seat, instead of both wanting the same seat.

## Next steps

- Add the Fairness Audit module (check allocation is balanced across
  candidate groups)
- Wrap all of this in a FastAPI backend with upload endpoints
- Build a simple React dashboard so this can be used without editing code
- Optionally upgrade embeddings from TF-IDF to a pretrained transformer
  model (e.g. Sentence-Transformers) for deeper semantic understanding
