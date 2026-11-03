# Judge report: Wave 1 (Tasks 2, 3, 5, 7, 9)

Date: 2026-11-03. Reviewed against `docs/superpowers/plans/2026-11-03-milestone-1-core-upgrade.md` and spec `2026-11-02-fairmatch-design.md`. Paths below are relative to `fairmatch/`.

## VERDICT: PASS_WITH_FIXES

Every public name, signature and return type matches the plan's Interfaces blocks exactly, so Wave 2 can code against the pinned signatures as written. The suite and lint are green. Three small behaviour defects need fixing before commit: one Review Focus crash, one optimality violation, and one wrong fairness verdict. Each fix below was applied to a scratch copy and checked: the full fast suite passes (34) and ruff is clean.

## Evidence

- `python -m pytest -m "not slow and not llm" -q`: **34 passed, 2 deselected** (4.6 s).
- `python -m pytest -m slow tests/test_embeddings.py`: **1 passed** (real bge model, 33 s).
- `python -m ruff check .`: **All checks passed!** (ruff 0.17.3).
- Shared files: `git diff HEAD --name-only` is empty. `requirements.txt`, `pyproject.toml`, `tests/conftest.py` and `core/models.py` are unmodified. Untracked files are only the five tasks' own files plus `core/data/skills.json` and the reports.
- Interface check (plan vs code): no mismatches.
  - T2 `taxonomy.py`: `Taxonomy.__init__(path: Path | None = None)` :10, `canonical -> str | None` :28, `all_terms -> list[str]` :32, `related -> frozenset[str]` :34, cached `get_taxonomy()` :39-41. The JSON has the required relations and aliases, and all 61 `SKILL_LIST` terms resolve.
  - T3 `llm.py`: `LLMClient(Protocol)` :26, `OpenAIClient` with a strict `json_schema` response_format :32-63, `get_llm_client() -> LLMClient | None` :66, `FakeLLMClient(profile=None, completion="", raises=False)` :75.
  - T5 `embeddings.py`: `Embedder(Protocol).encode` :6, `SentenceTransformerEmbedder(model_name="BAAI/bge-small-en-v1.5")` with lazy load, per-text cache and `normalize_embeddings=True` :12-39, `cosine_matrix` :42.
  - T7 `allocation.py`: `hungarian` :38, `gale_shapley` :54, `ALGORITHMS: dict[str, Callable]` :86.
  - T9 `fairness.py`: `GroupStats` :7, `FairnessReport` :16, `audit(allocation, group_of)` :23. Its rules match the plan, including the KeyError that names the missing id.
- Allocation probe: 400 random cases, with capacities -1..3, 0-5 candidates and many ties.
  - Capacity was never exceeded. No candidate was assigned twice. Assignments + unallocated always partition the candidate set, and both are sorted by candidate index. Repeated runs return the same output.
  - Hungarian equals brute force in all 388 cases small enough to brute-force.
  - Gale-Shapley has 0 blocking pairs in every case. Hungarian's total is always at least Gale-Shapley's.
  - Empty candidates or postings, all capacities 0 and negative capacity all return an empty Allocation.
- Taxonomy probe: the relation is symmetric, with no self-relations. Every `related` entry resolves and no term is claimed by two entries. Non-ASCII, empty and whitespace input gives `None` or `frozenset()`.
- LLM probe (openai 3.42.1):
  - The `openai` import is lazy: it is not imported until `OpenAIClient()` is constructed. With no key or an empty key, `get_llm_client()` returns None. `OPENAI_MODEL` is honoured.
  - A round trip through an `httpx.MockTransport` sends `response_format.type == "json_schema"` with `strict: true` and returns the parsed dict. `complete()` works.
- Mutation testing: 24 mutants. Killed 5/7 taxonomy, 3/3 llm, 2/3 embeddings, 5/6 allocation, 1/5 fairness. The survivors are listed under non-blocking notes.

## Blocking issues

### B1. Zero candidates crashes scoring when using the real embedder (`core/embeddings.py:27-28`, `:42-43`)

`SentenceTransformerEmbedder().encode([])` on a fresh instance returns shape `(0, 0)` without loading the model. The Embedder contract is `(n, d)`.

`cosine_matrix(that, postings_vecs)` then raises `ValueError: matmul ... size 384 is different from 0`. This is exactly the Review Focus case "zero candidates": Task 6 encodes the candidate texts first. Tasks 6 and 11 test with `fake_embedder`, which returns `(0, 64)`, so their tests will not catch it.

Fix: make `cosine_matrix` shape-safe. It also avoids loading the model just to learn `d`.

```python
def cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if a.shape[0] == 0 or b.shape[0] == 0:
        return np.zeros((a.shape[0], b.shape[0]))
    return a @ b.T
```

Add `test_cosine_matrix_with_empty_side`: `cosine_matrix(SentenceTransformerEmbedder().encode([]), np.ones((2, 4)))` has shape `(0, 2)` and the model is not loaded.

### B2. The Hungarian tie-break bonus can override a genuine score difference (`core/allocation.py:8`, `:48`)

The fixed `_EPS = 1e-12` times `outer(n..1, s..1)` gives a total bonus of up to `1e-12 * sum_{k<min(n,s)} (n-k)(s-k)`. That is only guaranteed below the 1e-6 resolution of Task 6's rounded totals up to about n = seats = 143.

Counterexample: n = seats = 1100 with 1-seat postings, diagonal scores 0.5, `s[0, n-1] = 0.5`, `s[n-1, 0] = 0.500001`. The true optimum is 550.000001, but `hungarian` returns 550.000000. The same happens at n = 1500. This breaks the spec §9 "Hungarian optimality" guarantee for large inputs (Milestone 2 data).

Fix: scale the bonus so its largest possible total stays below 1e-7.

```python
k = np.arange(min(n, s))
span = float(np.sum((n - k) * (s - k)))  # largest possible total bonus
bonus = (1e-7 / span) * np.outer(np.arange(n, 0, -1), np.arange(s, 0, -1))
```

After this fix:
- The counterexamples return the true optimum.
- The 388 brute-force cases and the tie cases (lowest indices win, including all-0.5 at 1000x1000) are unchanged.
- All 14 allocation tests pass.

Delete `_EPS`. Add a regression test using the 1100x1100 construction above; `linear_sum_assignment` solves it in about a second.

### B3. Four-fifths rule misclassifies exact-0.8 ratios (`core/fairness.py:56-57`)

Float division gives `(4/12)/(5/12) == 0.7999999999999999`, so `passes_four_fifths` is False although the ratio is exactly 4/5. A sweep over group sizes 1-40 found **424 of 1425** exact-0.8 cases reported as failing (e.g. 2/3 vs 5/6). fairlearn has the same float artefact, so `test_matches_fairlearn` cannot catch it.

Fix: compute the ratio from exact fractions. `float(Fraction(4, 5)) == 0.8`.

```python
from fractions import Fraction
...
exact = [Fraction(s.selected, s.size) for s in stats if s.size > 0]
ratio = float(min(exact) / max(exact))
```

Add `test_exact_four_fifths_boundary_passes`: A has 4 of 12 selected and B has 5 of 12, so `passes_four_fifths is True`. That test also kills the surviving `>=` -> `>` mutant. With the fix, `test_matches_fairlearn` still passes.

## Non-blocking notes

1. **Tie rule semantics** (`allocation.py:47-48`, `tests/test_allocation.py:75-83`). The bonus implements "maximise sum (n-i)(s-c)". It is deterministic but not lexicographic.
   - For `[[1,1,0,1],[1,0,0,1]]` (1-seat postings), Hungarian gives c0->p1, c1->p0, while Gale-Shapley gives c0->p0, c1->p3. Both are optimal.
   - Document the rule in a docstring.
   - `test_ties_are_deterministic` uses an all-equal matrix, which scipy resolves the same way without the bonus: the mutant `bonus = 0.0` survived. scipy alone differs from the bonus rule on 269 of 2000 random tie matrices. Add the partial-tie matrix above with its expected output.
2. **NaN scores** (`allocation.py:26-35`, `:61`). `hungarian` raises a scipy ValueError, while `gale_shapley` silently returns an arbitrary matching. Task 6 cannot produce NaN, but `_prepare` should reject non-finite input with the same ValueError.
3. **OpenAI timeouts** (`llm.py:36`). The SDK default is read timeout 600 s with 2 retries, so a network stall can hang the demo for minutes before fallback. Pass `timeout=30, max_retries=1`.
   - A refusal (`content=None`) raises TypeError at `:52`. That is acceptable only if Task 4 catches `Exception`, not just `openai.APIError`; tell the Task 4 agent.
   - `complete()` has no `temperature=0`. Acceptable, since it is narration only.
4. `FakeLLMClient.extract_profile` (`llm.py:83`) returns a shallow copy, so mutating the returned `skills` list changes the fake's stored profile. Use `copy.deepcopy`.
5. **Alias false positives for Task 4.** The `skills.json` aliases `express` (an English word), `js` and `vue` will match through the PhraseMatcher (e.g. "express interest" becomes `express.js`). Consider dropping `express` or using `expressjs`.
6. **Test gaps found by surviving mutants:**
   - `test_cosine_matrix_shape_and_range` (`test_embeddings.py:7-12`) only checks the range: a result scaled by 0.5 survived. Assert `np.allclose(m, a @ b.T)`.
   - Fairness: no test checks `mean_score` with selected members (dividing by group size survived), and none covers a KeyError for an id that is only in `unallocated`.
   - Taxonomy: `related()` with an alias argument (`related("AI")`) is untested (dropping canonicalisation survived), and so is the `Taxonomy(path)` argument.
   - LLM: no test that `get_llm_client()` returns an `OpenAIClient` when the key is set. Verified manually.
7. **test_taxonomy.py (Task 2 never saw a red step).** The tests are real, not tautologies.
   - Mutants for "no reverse edge", "case-sensitive canonical", "aliases ignored", "all_terms omits aliases" and "not cached" were all killed.
   - The symmetry test only bites because the shipped JSON lists ML->AI one way. Make it data-independent with a `tmp_path` JSON fixture containing a one-way relation.
8. `ruff format --check` would reformat 6 files. The plan only requires `ruff check`, which is clean.
9. The plan lists `conftest.py` under Task 5, but it was committed in Task 1 and already matches Task 5's fixture spec. Task 5 correctly left it untouched.
