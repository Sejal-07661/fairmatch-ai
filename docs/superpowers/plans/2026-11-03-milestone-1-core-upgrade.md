# FairMatch AI Milestone 1: Core Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the TF-IDF prototype in `fairmatch/app` with a tested `fairmatch/core` package: LLM-assisted parsing, transformer embeddings, hybrid scoring, Hungarian and Gale-Shapley allocation, algorithm comparison, fairness audit, and grounded explanations.

**Architecture:** `core` is pure Python (no web or DB imports). Every stage takes and returns plain dataclasses from `core/models.py`, so stages are tested with fake embedders and fake LLM clients. The old `app/` package stays working until the final task migrates `demo.py` and deletes it.

**Tech Stack:** Python 3.11+, spaCy, sentence-transformers (`BAAI/bge-small-en-v1.5`), OpenAI SDK (structured outputs), SciPy, NumPy, Fairlearn, pytest, ruff.

**Spec:** `docs/superpowers/specs/2026-11-02-fairmatch-design.md` (sections 2, 3, 5, 9 apply to this milestone; DB/API/frontend are later milestones).

## Global Constraints

- Only mainstream libraries; no new dependency beyond the Tech Stack line above.
- Allocation is deterministic: same inputs give the same output (ties broken by lower index).
- LLMs parse and narrate only; they never influence scores or allocation.
- Protected attributes are never read by `core.scoring` or `core.allocation`; only `core.fairness` takes group labels.
- Embedding model is `BAAI/bge-small-en-v1.5`; LLM model name comes from env `OPENAI_MODEL` (default `gpt-4o-mini`), key from `OPENAI_API_KEY`.
- Score weights are configurable and must sum to 1.0 (validated). Defaults: semantic 0.4, skill 0.4, experience 0.1, education 0.1.
- Core code lives in `fairmatch/core/`, tests in `fairmatch/tests/`; run all commands from `fairmatch/`.
- Without an API key, every LLM-dependent function falls back to a non-LLM path and records that it did.

## Review Focus

- Zero candidates or zero postings: allocation returns an empty result, not an exception.
- Posting with capacity 0, or total seats greater than candidates: no crash, seats stay empty.
- Resume with no recognizable skills, or non-ASCII text: parses to an empty skill list, scores 0 overlap.
- No `OPENAI_API_KEY`, or the OpenAI call raising: parser and explainer fall back and flag `used_fallback=True`.
- Fairness with a group of size 0, a single group, or nobody selected: metrics are defined, never divide by zero.

---

### Task 1: Project scaffolding and domain models

**Files:**
- Create: `fairmatch/core/__init__.py`, `fairmatch/core/models.py`, `fairmatch/tests/__init__.py`, `fairmatch/tests/test_models.py`, `fairmatch/pyproject.toml`
- Modify: `fairmatch/requirements.txt`

**Interfaces:**
- Produces (all `@dataclass(frozen=True)` in `core/models.py`):
  - `Candidate(id: str, name: str, raw_text: str, skills: tuple[str, ...], experience_years: int, education_level: int, used_fallback: bool = False)`
  - `Posting(id: str, title: str, raw_text: str, required_skills: tuple[str, ...], capacity: int, min_experience_years: int = 0, min_education_level: int = 0)`
  - `ScoreBreakdown(candidate_id: str, posting_id: str, semantic: float, skill_overlap: float, experience: float, education: float, matched_skills: tuple[str, ...], related_skills: tuple[tuple[str, str], ...], total: float)`
  - `Assignment(candidate_id: str, posting_id: str, score: float)`
  - `Allocation(algorithm: str, assignments: tuple[Assignment, ...], unallocated: tuple[str, ...])`
- Education levels are ints: 0 none, 1 diploma, 2 bachelor, 3 master, 4 doctorate.

- [ ] **Step 1: Initialize tooling.** Add to `requirements.txt`: `sentence-transformers`, `openai`, `fairlearn`, `pytest`, `ruff`. In `pyproject.toml` set pytest `testpaths = ["tests"]`, markers `slow` and `llm`, and ruff line-length 100. Run `git init` in the project root if it is still not a repository.
- [ ] **Step 2: Write the failing test** `test_models.py::test_models_are_frozen_and_hashable`: build a `Candidate`, assert `hash(c)` works and assigning `c.name = "x"` raises `dataclasses.FrozenInstanceError`; assert `Allocation("hungarian", (), ("c1",)).unallocated == ("c1",)`.
- [ ] **Step 3: Run** `pytest tests/test_models.py -v`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** the dataclasses in `core/models.py` exactly as listed.
- [ ] **Step 5: Run** `pytest tests/test_models.py -v` and `ruff check .`. Expected: PASS, no lint errors.
- [ ] **Step 6: Commit** `feat(core): scaffold core package and domain models`.

### Task 2: Skill taxonomy

**Files:**
- Create: `fairmatch/core/data/skills.json`, `fairmatch/core/taxonomy.py`, `fairmatch/tests/test_taxonomy.py`

**Interfaces:**
- `skills.json`: list of `{"name": str, "aliases": [str], "related": [str]}`. Seed it from `app/skills_data.py` `SKILL_LIST`, with at least these relations: `machine learning` related to `artificial intelligence`, `deep learning`, `scikit-learn`; `react.js` aliases `react`; `node.js` aliases `nodejs`; `postgresql` aliases `postgres`.
- Produces `class Taxonomy`: `__init__(path: Path | None = None)`; `canonical(term: str) -> str | None` (case-insensitive, resolves aliases); `all_terms() -> list[str]` (names and aliases, for phrase matching); `related(skill: str) -> frozenset[str]`; module-level `get_taxonomy() -> Taxonomy` (cached).

- [ ] **Step 1: Write failing tests:** `test_alias_resolves_to_canonical` (`canonical("React") == "react.js"`, `canonical("Postgres") == "postgresql"`); `test_unknown_term_is_none`; `test_related_is_symmetric` (if B in `related(A)` then A in `related(B)`); `test_ml_related_to_ai` (`"artificial intelligence" in related("machine learning")`).
- [ ] **Step 2: Run** `pytest tests/test_taxonomy.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `Taxonomy`; build the symmetric relation in `__init__` rather than relying on the JSON listing both directions.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): skill taxonomy with aliases and relations`.

### Task 3: LLM client interface

**Files:**
- Create: `fairmatch/core/llm.py`, `fairmatch/tests/test_llm.py`

**Interfaces:**
- Produces `class LLMClient(Protocol)`: `extract_profile(text: str) -> dict` returning `{"skills": list[str], "experience_years": int, "education_level": int}`; `complete(prompt: str) -> str`.
- Produces `class OpenAIClient` implementing it with structured outputs (JSON schema for `extract_profile`), and `def get_llm_client() -> LLMClient | None` returning `None` when `OPENAI_API_KEY` is unset.
- Produces `class FakeLLMClient` (in `core/llm.py`, for tests) with constructor `(profile: dict | None = None, completion: str = "", raises: bool = False)`; when `raises` is true both methods raise `RuntimeError`.

- [ ] **Step 1: Write failing tests:** `test_get_llm_client_none_without_key` (monkeypatch env var removed, result is `None`); `test_fake_client_returns_configured_profile`; `test_fake_client_can_raise`. Mark one `@pytest.mark.llm` test `test_openai_extract_profile_live` that skips unless the key is set and asserts `"python" in [s.lower() for s in result["skills"]]` for the text "5 years Python developer, M.Tech".
- [ ] **Step 2: Run** `pytest tests/test_llm.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the module. `OpenAIClient` uses `client.chat.completions.parse` or `response_format` with a JSON schema; keep it under ~60 lines.
- [ ] **Step 4: Run** `pytest tests/test_llm.py -v -m "not llm"`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): LLM client interface with OpenAI and fake implementations`.

### Task 4: Parser

**Files:**
- Create: `fairmatch/core/parser.py`, `fairmatch/tests/test_parser.py`

**Interfaces:**
- Consumes: `Taxonomy`, `LLMClient`, `Candidate`, `Posting`.
- Produces: `extract_skills_spacy(text: str, taxonomy: Taxonomy) -> tuple[str, ...]` (canonical, sorted, unique); `parse_candidate(id: str, name: str, text: str, llm: LLMClient | None = None, taxonomy: Taxonomy | None = None) -> Candidate`; `parse_posting(id: str, title: str, text: str, capacity: int, llm: LLMClient | None = None, taxonomy: Taxonomy | None = None) -> Posting`; `read_resume_file(path: Path) -> str` (PDF via PyMuPDF, DOCX via python-docx, else UTF-8 text; unknown suffix raises `ValueError`).
- Behavior: with an LLM, take its skills, map each through `taxonomy.canonical`, drop unknowns; on any LLM exception fall back to spaCy and set `used_fallback=True`. With `llm=None`, use spaCy with `used_fallback=True`. Postings never set `used_fallback` (no such field), they use the same strategy silently. Experience and education come from the LLM, or from regex ("3 years", "B.Tech/Bachelor" = 2, "M.Tech/Master/MCA" = 3, "PhD" = 4) on fallback. Add `pymupdf` and `python-docx` to `requirements.txt`.

- [ ] **Step 1: Write failing tests** using the prototype's sample resumes: `test_spacy_fallback_extracts_canonical_skills` (Aarav's resume yields `fastapi`, `mongodb`, `python`, `docker`; `used_fallback is True`); `test_alias_is_canonicalised` ("React" gives `react.js`); `test_llm_skills_filtered_through_taxonomy` (fake returns `["Python", "Basket Weaving"]`, result is `("python",)`, `used_fallback is False`); `test_llm_failure_falls_back` (fake with `raises=True` gives spaCy skills, `used_fallback is True`); `test_empty_and_non_ascii_text` (`""` and `"Dévéloppeur 日本語"` give `skills == ()`); `test_experience_regex` ("3 years" gives 3; none gives 0); `test_read_resume_file_rejects_unknown_suffix`.
- [ ] **Step 2: Run** `pytest tests/test_parser.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the prototype's blank-pipeline `PhraseMatcher` approach from `app/parser.py`, but build patterns from `taxonomy.all_terms()` and canonicalise matches.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): taxonomy-aware parser with LLM extraction and spaCy fallback`.

### Task 5: Embeddings

**Files:**
- Create: `fairmatch/core/embeddings.py`, `fairmatch/tests/test_embeddings.py`, `fairmatch/tests/conftest.py`

**Interfaces:**
- Produces: `class Embedder(Protocol)`: `encode(texts: list[str]) -> np.ndarray` (rows L2-normalised, shape `(n, d)`); `class SentenceTransformerEmbedder(model_name: str = "BAAI/bge-small-en-v1.5")` with an in-memory cache keyed by text so repeated texts are encoded once; `cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray` (plain dot product of normalised rows).
- `conftest.py` provides fixture `fake_embedder`: a deterministic `Embedder` that hashes lowercase word tokens into a 64-dim bag-of-words vector, normalised. Texts sharing words are closer; empty text gives a zero vector (not NaN).

- [ ] **Step 1: Write failing tests:** `test_cosine_matrix_shape_and_range`; `test_fake_embedder_similar_texts_closer` (shared-word texts score higher than disjoint); `test_empty_text_gives_zero_vector_not_nan`; `test_encode_caches_repeated_text` (count calls to the underlying model via a stub); `@pytest.mark.slow test_bge_relates_ml_and_ai` (real model: similarity("machine learning engineer", "AI engineer") greater than similarity("machine learning engineer", "pastry chef")).
- [ ] **Step 2: Run** `pytest tests/test_embeddings.py -v -m "not slow"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Lazy-load the SentenceTransformer on first `encode`; call it with `normalize_embeddings=True`; handle empty-string input by returning zeros.
- [ ] **Step 4: Run** `pytest tests/test_embeddings.py -v -m "not slow"`, then once `pytest -m slow tests/test_embeddings.py -v` (downloads the model). Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): sentence-transformer embeddings with cache`.

### Task 6: Hybrid scoring

**Files:**
- Create: `fairmatch/core/scoring.py`, `fairmatch/tests/test_scoring.py`

**Interfaces:**
- Consumes: `Candidate`, `Posting`, `ScoreBreakdown`, `Embedder`, `cosine_matrix`, `Taxonomy`.
- Produces: `@dataclass(frozen=True) ScoreWeights(semantic: float = 0.4, skill: float = 0.4, experience: float = 0.1, education: float = 0.1)` whose `__post_init__` raises `ValueError` unless the weights sum to 1.0 (tolerance 1e-9) and all are non-negative; `skill_overlap(candidate_skills, required_skills, taxonomy) -> tuple[float, tuple[str, ...], tuple[tuple[str, str], ...]]` returning ratio, exact matches, and related pairs `(required, candidate_skill)`; `score_matrix(candidates, postings, embedder, taxonomy=None, weights=ScoreWeights()) -> tuple[np.ndarray, list[list[ScoreBreakdown]]]` where the array has shape `(len(candidates), len(postings))` and equals `breakdown.total`.
- Rules: per required skill, credit 1.0 for an exact match, 0.5 if the candidate has a related skill, else 0; ratio = sum of credits / number of required skills (0.0 if none required). Experience score = `min(1, years / min_experience_years)` (1.0 when the minimum is 0). Education score is 1.0 if level >= minimum else `level / minimum`. Semantic is cosine clipped to `[0, 1]`. Totals are rounded to 6 decimals.

- [ ] **Step 1: Write failing tests:** `test_weights_must_sum_to_one`; `test_exact_match_full_credit_related_half_credit` (required `{"machine learning"}`: candidate with `machine learning` gives 1.0, with `artificial intelligence` gives 0.5, with `docker` gives 0.0, and the related pair is reported); `test_no_required_skills_gives_zero_overlap`; `test_experience_and_education_partial_credit` (1 of 2 years gives 0.5); `test_score_matrix_shape_matches_breakdowns` (using `fake_embedder`, 3 candidates x 2 postings, array entries equal `breakdown.total`); `test_empty_inputs_give_empty_matrix` (zero candidates gives shape `(0, n)`).
- [ ] **Step 2: Run** `pytest tests/test_scoring.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Encode all candidate and posting texts in two batched `encode` calls, then one `cosine_matrix`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): hybrid scoring with taxonomy-aware skill credit`.

### Task 7: Hungarian and Gale-Shapley allocation

**Files:**
- Create: `fairmatch/core/allocation.py`, `fairmatch/tests/test_allocation.py`

**Interfaces:**
- Consumes: `Candidate`, `Posting`, `Assignment`, `Allocation`; a score matrix `np.ndarray` of shape `(n_candidates, n_postings)`.
- Produces: `hungarian(candidates, postings, scores) -> Allocation` (algorithm `"hungarian"`); `gale_shapley(candidates, postings, scores) -> Allocation` (algorithm `"gale_shapley"`, candidates propose in descending score order, postings keep their best `capacity` proposers by score); `ALGORITHMS: dict[str, Callable]` mapping names to the functions.
- Rules: Hungarian expands each posting into `capacity` seats and uses `scipy.optimize.linear_sum_assignment(scores_expanded, maximize=True)` on a rectangular matrix (no padding). Both functions return assignments sorted by candidate index, list unassigned candidate ids in `unallocated`, never exceed capacity, and break score ties by lower index. Empty candidates, empty postings, or all capacities 0 give an `Allocation` with no assignments and every candidate unallocated.

- [ ] **Step 1: Write failing tests:** `test_hungarian_beats_greedy` (2 candidates, 2 single-seat postings where greedy-by-best-score assigns suboptimally; assert total equals the brute-force optimum computed with `itertools.permutations`); `test_capacity_never_exceeded` (parametrised over both algorithms, random matrices with seed, 8 candidates, postings with capacities 0, 1, 3); `test_more_candidates_than_seats_leaves_unallocated`; `test_more_seats_than_candidates_leaves_seats_empty`; `test_zero_candidates_or_postings` (no exception); `test_ties_are_deterministic` (all-equal matrix gives the same output on repeated runs, lowest indices win); `test_gale_shapley_equals_hungarian_when_one_clear_winner` (a case where the optimum is stable).
- [ ] **Step 2: Run** `pytest tests/test_allocation.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** both algorithms. Gale-Shapley needs no explicit algorithm text beyond: candidate-proposing deferred acceptance with a per-posting list capped at `capacity`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): capacity-aware Hungarian and Gale-Shapley allocation`.

### Task 8: Algorithm comparison

**Files:**
- Create: `fairmatch/core/compare.py`, `fairmatch/tests/test_compare.py`

**Interfaces:**
- Produces: `count_blocking_pairs(allocation: Allocation, candidates, postings, scores) -> int` where a pair (c, p) blocks if c scores p strictly higher than c's current posting (or c is unallocated), and p either has a free seat or its lowest-scoring assigned candidate scores strictly lower than c on p; `@dataclass(frozen=True) AlgorithmResult(allocation: Allocation, total_score: float, blocking_pairs: int, runtime_ms: float)`; `compare_algorithms(candidates, postings, scores) -> dict[str, AlgorithmResult]` keyed by algorithm name, covering every entry of `ALGORITHMS`.

- [ ] **Step 1: Write failing tests:** `test_gale_shapley_has_zero_blocking_pairs` (random seeded matrices, 20 cases); `test_hungarian_total_at_least_gale_shapley_total` (same cases); `test_blocking_pair_detected` (hand-built allocation with a known blocking pair returns 1); `test_compare_returns_all_algorithms_with_runtime` (keys equal `{"hungarian", "gale_shapley"}`, `runtime_ms >= 0`).
- [ ] **Step 2: Run** `pytest tests/test_compare.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** using `time.perf_counter` around each algorithm call.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): algorithm comparison with stability and runtime`.

### Task 9: Fairness audit

**Files:**
- Create: `fairmatch/core/fairness.py`, `fairmatch/tests/test_fairness.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) GroupStats(group: str, size: int, selected: int, selection_rate: float, mean_score: float)`; `@dataclass(frozen=True) FairnessReport(groups: tuple[GroupStats, ...], disparate_impact_ratio: float, passes_four_fifths: bool, parity_difference: float)`; `audit(allocation: Allocation, group_of: dict[str, str]) -> FairnessReport` where `group_of` maps candidate id to group label.
- Rules: selection rate = selected / size for each group, mean score is over selected members (0.0 if none). Disparate impact = min rate / max rate across non-empty groups; defined as 1.0 when the max rate is 0 or only one group exists. `passes_four_fifths` is `ratio >= 0.8`. `parity_difference` = max rate minus min rate. Candidates missing from `group_of` raise `KeyError` naming the id.

- [ ] **Step 1: Write failing tests:** `test_equal_rates_give_ratio_one`; `test_disparate_impact_below_four_fifths_fails` (group A rate 0.5, group B rate 0.25 gives ratio 0.5, `passes_four_fifths is False`); `test_single_group_is_ratio_one`; `test_nobody_selected_is_ratio_one`; `test_missing_group_label_raises_keyerror`; `test_matches_fairlearn` (compare `disparate_impact_ratio` with `fairlearn.metrics.demographic_parity_ratio` on a seeded random case).
- [ ] **Step 2: Run** `pytest tests/test_fairness.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `audit`; group sizes come from `group_of` values (all candidates), selected counts from `allocation.assignments`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): fairness audit with disparate impact and parity metrics`.

### Task 10: Explainability

**Files:**
- Create: `fairmatch/core/explain.py`, `fairmatch/tests/test_explain.py`

**Interfaces:**
- Consumes: `ScoreBreakdown`, `Candidate`, `Posting`, `LLMClient`.
- Produces: `@dataclass(frozen=True) Explanation(candidate_id: str, posting_id: str, reasons: tuple[str, ...], narrative: str, used_fallback: bool)`; `explain(breakdown, candidate, posting, weights: ScoreWeights, llm: LLMClient | None = None) -> Explanation`.
- Rules: `reasons` is built deterministically from the breakdown, one line per signal with its weighted contribution (e.g. `"Skill overlap 0.67 x 0.4 = 0.27 (matched: python, fastapi)"`), plus a line for each related-skill pair. The narrative is the LLM's completion of a prompt that contains only those reasons and the two names; on `llm=None` or any exception, the narrative is the reasons joined into one sentence and `used_fallback=True`. The LLM is never given raw resume text.

- [ ] **Step 1: Write failing tests:** `test_reasons_report_weighted_contributions` (contributions sum to `breakdown.total` within 1e-3); `test_related_skill_pair_appears_in_reasons`; `test_llm_narrative_used_and_prompt_excludes_resume_text` (a recording fake captures the prompt; assert `candidate.raw_text` is not a substring of it); `test_fallback_when_llm_raises`; `test_fallback_when_no_llm`.
- [ ] **Step 2: Run** `pytest tests/test_explain.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `explain`; extend `FakeLLMClient` usage in the test via a small recording subclass defined in the test file.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): grounded explanations with deterministic fallback`.

### Task 11: Pipeline, demo migration and cleanup

**Files:**
- Create: `fairmatch/core/pipeline.py`, `fairmatch/tests/test_pipeline.py`
- Modify: `fairmatch/demo.py`, `fairmatch/README.md`
- Delete: `fairmatch/app/` (after the demo runs on `core`)

**Interfaces:**
- Produces: `@dataclass(frozen=True) PipelineResult(candidates, postings, breakdowns: list[list[ScoreBreakdown]], results: dict[str, AlgorithmResult], explanations: dict[str, tuple[Explanation, ...]], fairness: dict[str, FairnessReport] | None)`; `run_pipeline(candidates_in: list[dict], postings_in: list[dict], group_of: dict[str, str] | None = None, embedder: Embedder | None = None, llm: LLMClient | None = None, weights: ScoreWeights = ScoreWeights()) -> PipelineResult`. Input dicts use the prototype's shape (`name`, `resume_text`; `title`, `posting_text`, `capacity`) and ids are generated as `c1..`, `p1..`. `fairness` is `None` when `group_of` is `None`.

- [ ] **Step 1: Write failing tests** with `fake_embedder` and the prototype sample data: `test_pipeline_runs_end_to_end` (both algorithms present, no posting exceeds capacity, every allocated candidate has an explanation); `test_pipeline_without_groups_has_no_fairness`; `test_pipeline_with_groups_audits_each_algorithm`; `test_pipeline_with_empty_inputs`.
- [ ] **Step 2: Run** `pytest tests/test_pipeline.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `run_pipeline` wiring Tasks 4-10; default embedder is `SentenceTransformerEmbedder()`, default LLM is `get_llm_client()`.
- [ ] **Step 4: Rewrite `demo.py`** to call `run_pipeline` on `sample_data` with assumed demo group labels (assign candidates alternately to `"group_a"` and `"group_b"`, labelled as demo-only in the output), printing extracted skills, the score table, both allocations side by side with total score, blocking pairs and runtime, the fairness report, and each explanation. Update `README.md` status table and run instructions (`pip install -r requirements.txt`, `python demo.py`, optional `OPENAI_API_KEY` for LLM parsing and narratives).
- [ ] **Step 5: Run** `python demo.py`, then `pytest -m "not slow and not llm" -v` and `ruff check .`. Expected: demo prints all sections without errors; all tests pass; no lint errors.
- [ ] **Step 6: Delete `fairmatch/app/`** and re-run `python demo.py` and the test suite. Expected: unchanged results.
- [ ] **Step 7: Commit** `feat(core): pipeline, migrated demo, remove prototype app package`.
