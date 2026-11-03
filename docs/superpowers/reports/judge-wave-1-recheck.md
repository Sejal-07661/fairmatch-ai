# Judge re-check: Wave 1 fixes (B1-B3)

Date: 2026-11-03. Re-verifies the blocking issues from `judge-wave-1.md` after the uncommitted fixes. Paths are relative to `fairmatch/`. The slow BGE test was skipped on request.

## VERDICT: PASS

- B1 (embeddings empty side): **FIXED**
- B2 (Hungarian tie bonus at scale): **FIXED**
- B3 (four-fifths 0.8 float boundary): **FIXED**
- New blocking issues: **0**. The slow BGE test was not run, by instruction.

## Check 1: suite, lint, shared files, layering

- `python -m pytest -m "not slow and not llm" -q`: **49 passed, 2 deselected** (7.1 s). Earlier it was 34, so 15 tests were added.
- `python -m ruff check .`: **All checks passed!**
- `git diff HEAD --stat -- requirements.txt pyproject.toml tests/conftest.py core/models.py` is empty. `git diff HEAD --name-only` is also empty: no tracked file changed. The untracked files are still only the five tasks' modules and tests, `core/data/`, and the reports.
- `grep -rn "from app\|import app" core tests`: no matches (rc=1).
- Result: **PASS**

## Check 2: B1 (embeddings empty side)

- `core/embeddings.py:42-47`: `cosine_matrix` coerces both inputs to float arrays and returns `np.zeros((a.shape[0], b.shape[0]))` when either side has 0 rows.
- Scratch script `b1_check.py`, 14 assertions, all OK:
  - Shapes come out right for (0,4)x(2,4) -> (0,2), (2,4)x(0,4) -> (2,0), (0,0)x(2,4) -> (0,2), (2,4)x(0,0) -> (2,0), (0,4)x(0,4) and (0,0)x(0,0) -> (0,0), and (3,4)x(2,4) -> (3,2).
  - For non-empty input, the result still equals `a @ b.T`.
  - On a fresh `SentenceTransformerEmbedder()`, `encode([])` returns (0,0) and does not load the model: `_model is None` and `sentence_transformers` is not in `sys.modules`.
  - `cosine_matrix(encode([]), ones(2,384))` gives (0,2); swapping the sides gives (3,0).
- Regression test `tests/test_embeddings.py:16-21` `test_cosine_matrix_with_empty_side` checks the shape and `_model is None`. `test_cosine_matrix_shape_and_range` now also asserts `allclose(m, a @ b.T)`, which closes non-blocking note 6.
- Result: **B1 FIXED**

## Check 3: B3 (four-fifths float boundary)

- `core/fairness.py:57-58` computes the ratio from exact fractions: `float(min(Fraction(sel, size)) / max(...))`. The guards for a single group and for nobody selected (`:54-55`) are unchanged.
- Scratch script `b3_check.py` swept two groups with sizes 1-40 and every selection count, through `audit()`:
  - There are **2850 exact-4/5 cases**, which is the earlier judge's 1425 counted with either group as the lower one. **0 misclassified**: every case has `passes_four_fifths is True` and `disparate_impact_ratio == 0.8`.
  - Of the **69,762 non-exact cases** with a true ratio in [0.75, 0.85], **0 misclassified**: `passes_four_fifths` always equals the exact `ratio >= 4/5`.
  - Spot checks: 2/3 vs 5/6 gives 0.8 and True; 4/12 vs 5/12 gives 0.8 and True.
- Regression test `tests/test_fairness.py:75-79` `test_exact_four_fifths_boundary_passes` covers 4/12 vs 5/12.
- New tests `test_mean_score_over_selected_only` (`:82`) and `test_unallocated_missing_group_label_raises_keyerror` (`:93`) close the fairness gaps in non-blocking note 6.
- Result: **B3 FIXED**

## Check 4: B2 (Hungarian tie bonus at scale), probe, non-finite input, mutants

- `core/allocation.py:51-53`: the bonus is `(1e-7 / span) * outer(n..1, s..1)`, where `span = sum_{k<min(n,s)} (n-k)(s-k)`. By the rearrangement inequality, `span` is the largest possible total of `(n-i)(s-c)`, so any two matchings' bonuses differ by less than 1e-7. `_EPS` is gone. The tie rule is now documented in a comment at `:47-50`.
- Counterexample (scratch `b2_check.py`): 1-seat postings, diagonal 0.5, `s[0,n-1]=0.5`, `s[n-1,0]=0.500001`.
  - n=1100: Hungarian total **550.000001000**, which is correct.
  - n=1500: **750.000001000**, also correct.
- Random probe, **300 cases**: 0-5 candidates, 0-4 postings, capacities -1..3. 60% of the score matrices are drawn from {0, .25, .5, .75, 1}, which gives heavy ties; the rest are uniform, some with injected row ties. Every check had 0 failures:
  - Capacity was never exceeded.
  - No candidate was assigned twice. Assignments + unallocated partition the candidates, and both are sorted. Each `Assignment.score == scores[i,j]`.
  - Hungarian equals the brute-force optimum in **300/300** cases (worst gap 4.4e-16).
  - Hungarian's total is always at least Gale-Shapley's.
  - Gale-Shapley has **0 blocking pairs**. This was checked against the implementation's tie-broken strict preferences, which implies weak stability too.
  - Two runs on the same input give equal `Allocation`s.
- Non-finite input: NaN, +inf and -inf all raise `ValueError("scores must be finite (no NaN or inf)")` in both `hungarian` and `gale_shapley`, via `_prepare` at `:26-27`. This closes non-blocking note 2. `test_non_finite_scores_rejected` (`tests/test_allocation.py:128-132`) covers NaN and inf for both algorithms.
- Mutant checks, each run on a scratch copy of `core/` plus `tests/test_allocation.py` and `conftest.py`. I confirmed `core.allocation.__file__` resolved to the scratch copy, and the source file is untouched (`:53` still holds the fixed line).
  - `bonus = 0.0`: **killed**. `test_hungarian_partial_tie_exact_output` fails, returning `[('c0','p0'),('c1','p3')]` where `[('c0','p1'),('c1','p0')]` is expected. 1 failed, 19 passed.
  - Old bonus `1e-12 * outer(...)`: **killed**. `test_tie_bonus_does_not_override_real_difference_at_scale` fails with 550.0 where 550.000001 is expected. 1 failed, 19 passed. So the regression test really reproduces B2.
- Result: **B2 FIXED**

## Check 5: hardening in llm.py and taxonomy (review only), slow test

- `core/llm.py`:
  - `OpenAI(..., timeout=30, max_retries=1)` at `:37-40` closes note 3.
  - A refusal (`content is None`) now raises `RuntimeError` instead of `TypeError`, in `extract_profile` at `:57-58` and in `complete` at `:71-72`. Task 4 still has to catch `Exception` broadly, not just `openai.APIError`.
  - `FakeLLMClient.extract_profile` returns `copy.deepcopy` (`:93`), which closes note 4. `test_fake_client_returns_copy` covers it.
  - `test_get_llm_client_returns_openai_with_key` closes the llm part of note 6.
  - Public signatures are unchanged.
- `core/data/skills.json`:
  - The ambiguous aliases `express` and `js` are removed and `expressjs` was added (`test_ambiguous_aliases_removed`). `vue` is still an alias of `vue.js`; I'm leaving that as non-blocking.
  - All 61 legacy `SKILL_LIST` terms still resolve (checked with a scratch one-liner; no test imports `app`).
- `tests/test_taxonomy.py`: the symmetry test now uses a `tmp_path` one-way relation, so it no longer depends on the shipped data (note 7). `test_related_accepts_alias` closes the taxonomy part of note 6. `taxonomy.py` itself has the same public interface.
- The slow BGE test was **not run**, as instructed; the coordinator will run it separately.
- After all checks, `git status` shows only the same untracked files as before plus this report, and `git diff HEAD` is empty. The judge did not modify any source.

## Non-blocking notes (new)

1. **Tie-break granularity at large n** (`core/allocation.py:51-53`). The per-unit bonus `1e-7/span` shrinks like `n^-3`. At n=s=1100 it is about 2e-16, roughly the float ulp of a 0.5 score. Beyond about 1000x1000, the "favours low indices" tie rule therefore degrades to whatever scipy picks. That pick is still deterministic, and optimality at 1e-6 resolution is unaffected, so this is fine. The comment at `:47-50` could mention it.
2. `core/llm.py:37-40` has odd hanging-indent formatting. `ruff check` is clean; `ruff format` would fix it.
3. The `vue` alias remains (see above).

## Blocking issues

None. All three earlier blockers are fixed, and no new blocking issues were found.
