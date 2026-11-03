# Milestone 1 Final Judge Report

Status: COMPLETE. VERDICT: PASS_WITH_FIXES (2 blocking issues). Scope: commits 54bd564..b1917f9 plus the uncommitted Task 11 diff (git diff HEAD) and all of fairmatch/core.

## Check 1a: test suite and lint
- `python -m pytest -m "not slow and not llm" -q` -> 115 passed, 2 deselected in 13.30s.
- `python -m ruff check .` -> All checks passed!

## Check 1b: app package removal, pyproject, requirements
- `ls fairmatch/app` -> "No such file or directory". `git diff HEAD --stat` shows all 6 `app/*.py` deleted.
- `grep -rnE "^\s*(from|import)\s+app(\.|\s|$)"` over all .py -> no matches (exit 1). No `app/` path references in .py/.toml/.txt/.md.
- `pyproject.toml`: the `extend-exclude = ["app", "demo.py"]` line is removed (git diff confirms); ruff now lints demo.py and passes.
- Third-party top-level imports across core/, tests/, demo.py, sample_data/: docx, fairlearn, fitz, numpy, openai, pytest, scipy, sentence_transformers, spacy.
  requirements.txt: spacy, scikit-learn, scipy, numpy, sentence-transformers, openai, fairlearn, pymupdf (fitz), python-docx (docx), pytest, ruff.
  Every import is covered, including the lazy ones (fitz, docx in parser.read_resume_file; openai in OpenAIClient.__init__; sentence_transformers in SentenceTransformerEmbedder._load).
  `scikit-learn` is no longer imported directly (TF-IDF prototype gone); it remains a transitive dependency of fairlearn, so keeping it is harmless (non-blocking note).
- Result: PASS.

## Check 2: Global Constraints
Scratch scripts: scratchpad `det_run.py`, `check2.py` (session scratch dir, not in repo).
- **Deterministic output**: `det_run.py` dumps candidates, postings, every breakdown, both allocations (total, blocking pairs), every explanation and both fairness reports (runtime_ms excluded) for a fake-embedder run on sample_data with group labels. Run in two separate processes with `PYTHONHASHSEED=1` and `PYTHONHASHSEED=987`: `diff` -> IDENTICAL (55 lines). Sample result: both algorithms assign c2->p2, c3->p3, c4->p4, c5->p5, c6->p1, unallocated c1, total 4.434611, 0 blocking pairs. Tie-breaking by lower index is implemented (allocation.py:47-55 bonus term; gale_shapley prefs key `(-score, j)` at :66 and eviction key `(score, -k)` at :81) and covered by `test_ties_are_deterministic`. PASS.
- **Protected attributes never read by scoring/allocation**: grep for group/gender/category/protected/demograph in core/ hits only fairness.py and pipeline.py:29,37,72-73. In pipeline, `group_of` is used only as `audit(r.allocation, group_of)` (pipeline.py:72), after `score_matrix` (:53) and `compare_algorithms` (:54) have run; neither signature accepts groups. Empirically: breakdowns and allocations are identical with group_of=None, alternating groups, and flipped groups; an extra `gender` key in candidate dicts is ignored (run_pipeline reads only `name`/`resume_text`, `title`/`posting_text`/`capacity`). PASS.
- **Weights sum to 1 validated**: `ScoreWeights.__post_init__` (scoring.py:19-26) rejects (0.5,0.5,0.1,0.1) "must sum to 1.0", negatives, NaN, and a 1e-6 drift; accepts defaults 0.4/0.4/0.1/0.1 and 0.25x4. PASS.
- **Env var names**: `OPENAI_API_KEY` read at llm.py:37 and :77; `OPENAI_MODEL` with default `"gpt-4o-mini"` at llm.py:41. Embedding model default `BAAI/bge-small-en-v1.5` at embeddings.py:13. PASS.
- **No API key -> fallback flagged**: `get_llm_client()` returns None for an unset and for an empty key. A run with `llm=None` and no key: all 6 candidates `used_fallback=True`, all 10 explanations `used_fallback=True`. Postings have no flag, as the plan specifies. PASS.
- **Core has no web/DB imports**: grep for fastapi|sqlalchemy|flask|django|redis|celery|psycopg|httpx|requests|sqlite|pymongo|urllib|socket|aiohttp|pydantic in core/ -> no matches. (openai is the sanctioned LLM SDK.) PASS.

## Check 3: Review Focus, each via run_pipeline with the fake embedder (scratch `check3.py`)
`caps_ok` asserts for every algorithm: no posting over max(capacity, 0), no candidate assigned twice, assignments plus unallocated equal the full candidate set, and the two sets are disjoint.
| Case | Result |
|---|---|
| zero candidates (5 postings) | no exception; 0 assignments, 0 unallocated, total 0.0, 0 blocking pairs, 0 explanations; breakdowns `[]`; fairness DI 1.0, pass, parity 0.0 |
| zero postings (6 candidates) | no exception; 0 assignments, 6 unallocated; breakdowns `[[]]*6`; fairness DI 1.0 (nobody selected) |
| both empty | no exception; all empty |
| one posting capacity 0 | p1 never used; 4 assigned, 2 unallocated; caps_ok True |
| all capacity 0 (+ groups) = nobody selected | 0 assigned, 6 unallocated; fairness DI 1.0, pass True, parity 0.0 (no division by zero) |
| negative capacity (-2) | treated as 0; caps_ok True |
| seats (15) > candidates (2) | both placed, seats stay empty, caps_ok True |
| no recognizable skills / empty resume `""` | skills `()`, skill_overlap 0.0 on every posting; empty text has semantic 0.0 (zero vector, no NaN) |
| non-ASCII (`"Dévéloppeur 日本語 ñandú"`, accented names, CJK group labels) | skills `()`, overlap 0.0; mixed text `"Ingénieur Python et Docker"` -> (docker, python); no crash |
| llm=None (no key) | all candidates and explanations `used_fallback=True` |
| FakeLLMClient(raises=True) | all candidates and explanations `used_fallback=True`; breakdowns identical to the llm=None run |
| FakeLLMClient(profile, completion="Good fit.") | candidates `used_fallback=False`; narrative "Good fit.", explanations `used_fallback=False` |
| group_of missing c4 (assigned) | `KeyError('c4')`; documented in run_pipeline docstring (pipeline.py:36-39) and tested (`test_pipeline_missing_group_label_raises`) |
| group_of missing c1 (the unallocated one) | `KeyError('c1')`; unallocated ids are checked too (fairness.py:26-30) |
| a group with zero allocated (group z = {c1}) | z: size 1, selected 0, rate 0.0, mean 0.0; DI 0.0, fails four-fifths, parity 1.0 |
| single group | DI 1.0, pass, parity 0.0 |
| group_of={} with zero candidates | groups `()`, DI 1.0 |
Group "of size 0" cannot occur: sizes are counted from `group_of` values (fairness.py:32-34), so each listed group has size >= 1. The `if size` guard at :47 stays as defensive code.

Findings from this check (non-blocking):
- N1. `group_of` keyed by name rather than generated id raises `KeyError('c2')`, which names the id. That is correct, but the docstring does not say outright that `group_of` is keyed by the generated `c1..` ids (pipeline.py:34 only says "Ids are generated as c1.. / p1.. in input order").
- N2. A `group_of` holding ids not in the run (`c99`, `c100`) is accepted without complaint, and they inflate group sizes: group a reads size 5, selected 2, where the true figure is size 3, selected 2. That skews the DI ratio. It follows plan Task 9 ("sizes come from group_of values"), so it is not a defect against the plan. Still, run_pipeline knows the candidate set and could reject or filter unknown ids.
- Result: every Review Focus item PASSES.

## Check 4: Pipeline contract vs plan Task 11 (scratch `check4.py`)
- `PipelineResult` is `@dataclass(frozen=True)` with fields in the plan's order and types: candidates, postings, `breakdowns: list[list[ScoreBreakdown]]`, `results: dict[str, AlgorithmResult]`, `explanations: dict[str, tuple[Explanation, ...]]`, `fairness: dict[str, FairnessReport] | None` (pipeline.py:16-23). OK.
- Signature: `run_pipeline(candidates_in, postings_in, group_of=None, embedder=None, llm=None, weights: ScoreWeights | None = None)`. The plan has `weights: ScoreWeights = ScoreWeights()`; the None default is a compatible superset. It is resolved at pipeline.py:41, before both `score_matrix` (:53) and `explain` (:64). With weights 0.25x4 every reason line reads "x 0.25", and the contributions sum to the breakdown total within 1e-3. `weights=None` gives the same breakdowns as the default run. Defaults follow the plan: `SentenceTransformerEmbedder()` (:42) and `get_llm_client()` (:43). OK.
- Ids are `c1..c6` and `p1..p5` in input order; names and capacities are preserved. Breakdowns are 6x5 and each `breakdowns[i][j]` carries `(candidates[i].id, postings[j].id)`. The score matrix equals the breakdown totals. OK.
- `fairness is None` without group_of. With group_of it is keyed `hungarian`, `gale_shapley`, the same keys as `results` and `explanations`. OK.
- Explanations: per algorithm, a tuple with exactly one Explanation per assignment, in assignment order, with matching (candidate_id, posting_id). Every `assignment.score` equals its breakdown total, and `total_score` equals the sum. OK.
- Note N3: `PipelineResult` is frozen, but `candidates`/`postings`/`breakdowns` are lists, so it is only shallowly immutable. This matches the plan's types and is not blocking.
- Result: PASS.

## Check 5: Cross-module consistency
Every inter-module call site was matched against the callee's signature:
- pipeline.py:46 `parse_candidate(f"c{i}", name, resume_text, llm=)` matches `(id, name, text, llm, taxonomy)`; :50 `parse_posting(f"p{i}", title, posting_text, capacity, llm=)` matches `(id, title, text, capacity, llm, taxonomy)`.
- pipeline.py:53 `score_matrix(candidates, postings, embedder, weights=)`: the taxonomy defaults to `get_taxonomy()`, the same cached instance the parser uses (parser.py:88/96, scoring.py:71).
- scoring.py:86 `skill_overlap(c.skills, p.required_skills, taxonomy)`: order and types are right. Related pairs are `(required, candidate_skill)`, which explain.py:33 renders as "Related skill: {required} is related to {candidate's}".
- pipeline.py:54 -> compare.py:56 `fn(candidates, postings, scores)` and :61 `count_blocking_pairs(alloc, candidates, postings, scores)`: matches.
- pipeline.py:60-66 `explain(breakdown, candidate, posting, weights, llm)`: matches the positional order of explain.py:37-43. The breakdown is looked up via `cidx[a.candidate_id]` and `pidx[a.posting_id]`, and those ids are the same strings in ScoreBreakdown (scoring.py:96, `c.id`, `p.id`) and Assignment (allocation.py:17, `candidates[i].id`, `postings[j].id`). check4 verified alignment empirically.
- pipeline.py:72 `audit(r.allocation, group_of)`: matches. Group labels: run_pipeline does no mapping. `group_of` is passed through unchanged and must be keyed by the generated candidate ids `c1..cN` (input order). demo.py:12 and test_pipeline.py:34/46 both build it that way. The docstring documents the id scheme and the KeyError, but not in so many words that `group_of` keys are those ids (note N1). Keying by name fails loudly with a KeyError naming a generated id, which is safe.
- Hungarian tie bonus (< 1e-7 in total) against scores rounded to 6 decimals (scoring.py:90-94): consistent, so the bonus can never flip a real difference.
- No argument-order, type or name mismatches found. PASS.

## Check 6: Spec section 9 tests, plus independent re-verification (scratch `check6.py`)
- Seat capacity never exceeded: `test_capacity_never_exceeded` (test_allocation.py:34), both algorithms, 20 seeds, capacities 0/1/3, plus no double assignment and a complete partition.
- Hungarian optimality vs brute force: `test_hungarian_beats_greedy` (:22) and `test_hungarian_matches_brute_force_with_capacity` (:86, itertools.permutations over expanded seats).
- Gale-Shapley zero blocking pairs: `test_gale_shapley_has_zero_blocking_pairs` (test_compare.py:24), 20 random cases with capacities 0-3.
- Fairness cross-check with fairlearn: `test_matches_fairlearn` (test_fairness.py:59) against `demographic_parity_ratio`.
- One test file per core module (11 of 11).
- Independent re-check: 300 random cases (n 0-5, m 0-3, capacities -1..2, half with discrete tied scores). Hungarian total matches an exhaustive brute force (combinations x permutations) in 0/300 mismatches. Gale-Shapley has 0 blocking pairs by both `count_blocking_pairs` and an independent checker (0 failures). Capacity was never exceeded. `count_blocking_pairs` agrees with the independent checker on Hungarian allocations too. 200 random fairness cases against fairlearn: `disparate_impact_ratio` vs `demographic_parity_ratio` 0 mismatches and `parity_difference` vs `demographic_parity_difference` 0 mismatches (fairlearn's NaN for nobody-selected maps to the spec's 1.0).
- PASS.

## Blocking issue B1 (found while probing Check 2/4): the "fast" suite makes live LLM calls whenever OPENAI_API_KEY is set
- Where: fairmatch/tests/test_pipeline.py:15, 30, 35, 41, 47, 55 call `run_pipeline(..., llm=None)`. In core/pipeline.py:43, `llm=None` means "use `get_llm_client()`", which builds an `OpenAIClient` whenever `OPENAI_API_KEY` is set. tests/conftest.py has no env isolation; only test_llm.py monkeypatches the key.
- Evidence: `OPENAI_API_KEY=dummy OPENAI_BASE_URL=http://127.0.0.1:9/v1 pytest -m "not slow and not llm" tests/test_pipeline.py -k "end_to_end or without_groups"` took 96.32 s and 94.49 s per test (21 attempted LLM calls each, with retries). Without the key the same two tests take 0.02 s and 0.01 s. With a real key, the 8 affected tests would make about 170 paid live calls, and their parsed skills and allocations would depend on the LLM, so the run is not deterministic.
- Why blocking: README.md:29-31 tells users to set `OPENAI_API_KEY` for the demo, and README.md:38 gives this exact test command. The `llm` marker is defined as "tests needing a live LLM API key" (pyproject.toml), and `-m "not llm"` is supposed to exclude live calls. Today it does not.
- Fix (tests only, no core change), in fairmatch/tests/conftest.py:
  ```python
  @pytest.fixture(autouse=True)
  def _no_live_llm(request, monkeypatch):
      if request.node.get_closest_marker("llm") is None:
          monkeypatch.delenv("OPENAI_API_KEY", raising=False)
  ```
  `test_get_llm_client_returns_openai_with_key` still works because its own `setenv` runs after the autouse fixture. `test_openai_extract_profile_live` is marked `llm`, so it keeps the key. Optionally add a test that sets a dummy key and asserts `run_pipeline(..., llm=None)` still finishes quickly.

## Check 7: demo.py and README.md
demo.py (63 lines, ruff-clean now that the exclusion is gone):
- It calls `run_pipeline(CANDIDATES, POSTINGS, group_of=...)` with demo-only alternating labels `group_a`/`group_b`, covering every id c1..c6, so the audit cannot raise KeyError. It prints the plan's five sections: [1] extracted skills with exp/edu, plus each posting's capacity and requirements; [2] the score table; [3] both allocations with total score, blocking pairs and runtime, including unallocated candidates; [4] the fairness report, labelled "DEMO-ONLY, assigned alternately"; [5] each explanation's reasons and narrative. This matches plan Task 11 Step 4.
- Windows encoding: everything the no-key demo prints is ASCII. A scan of demo.py, core/*.py, core/data/skills.json and sample_data/*.py finds one non-ASCII character, a U+2019 inside a regex at core/parser.py:45, which is never printed. Reasons use "x", not a multiplication sign. The default path therefore cannot hit UnicodeEncodeError. The one risk is the LLM narrative with a key set: printed at demo.py:55, it may contain characters outside cp1252, such as U+2011 or an arrow. This shell's piped stdout is cp1252, and `python -c "print('a‑b →')" | cat` raises `UnicodeEncodeError: 'charmap' codec can't encode character '‑'`. An interactive console is fine (Python uses UTF-8 console I/O), but `python demo.py > out.txt` with a key could crash. Non-blocking note N4; fix: `sys.stdout.reconfigure(errors="replace")` at the top of `main()`.
- Module docstring command `python demo.py`: correct.

README.md:
- Status table (:8-20): every "Done" row names a module that exists and does what it says. Run commands (:24-27, `pip install -r requirements.txt`, `python demo.py`), the optional `OPENAI_API_KEY` note (:29-31), the demo description (:33-36, 6 candidates x 5 postings, sections, demo-only groups) and the test/lint commands (:38) are accurate. Rows :19-20 have 2 cells in a 3-column table (cosmetic). `OPENAI_MODEL` is not mentioned (note N5).

## Blocking issue B2: README.md still carries stale TF-IDF-prototype claims that contradict the new code
- README.md:40-50 ("Why the Hungarian Algorithm matters here") still says the algorithm "allocated the stronger match (Ishaan, 0.759)". The paragraph is byte-for-byte the prototype's (`git show HEAD:fairmatch/README.md`), so 0.759 is a TF-IDF-era score. Under the current formula, Ishaan and Aarav both get skill 1.0, experience 1.0 and education 1.0 on "Backend Developer Intern" (posting p1 requires docker, fastapi, mongodb, python, rest api, with no experience or education minimum). Their score is therefore 0.6 + 0.4 x cosine, and 0.759 would need a BGE cosine of about 0.40. That is far below bge-small-en-v1.5's typical range for related texts, and it disagrees with the Task 11 report's demo total of 4.686 over 5 seats. It also omits Gale-Shapley, which the demo now prints side by side.
- README.md:56-57 ("Next steps"): "Optionally upgrade embeddings from TF-IDF to a pretrained transformer model (e.g. Sentence-Transformers)". This is already done (README.md:12, core/embeddings.py:13), so the README contradicts itself.
- Why blocking: plan Task 11 Step 4 requires the README update, and this is the user-facing document for the viva. Doc-only fix.
- Fix: delete the TF-IDF bullet at :56-57. Rewrite :40-50 without a hard-coded score: "Aarav and Ishaan both fully cover the Backend Developer Intern requirements, so semantic similarity decides. Hungarian maximises the total over all seats and Gale-Shapley produces a stable matching. On the sample data both leave Aarav unallocated; see section [3] of the demo output for the actual scores." Alternatively, paste the real numbers from a `python demo.py` run. Optionally add a "Next steps" line for Milestone 2 (DB + FastAPI + Celery) to match spec section 10.

(Addendum to Check 2: with a dummy key and no network, `get_llm_client()._model` is `gpt-4o-mini` by default and `gpt-4.1-nano` once `OPENAI_MODEL=gpt-4.1-nano` is set. Env handling confirmed.)

## Non-blocking notes
- N1. pipeline.py:34 docstring: state explicitly that `group_of` is keyed by the generated candidate ids (`c1..cN`, input order), not by name. (Keying by name already fails loudly with a KeyError.)
- N2. A `group_of` holding ids absent from the run (e.g. stale `c99`) silently inflates group sizes and skews the DI ratio. Sample: group a read size 5, selected 2, where the truth is 3 and 2. This is plan-conformant (Task 9), but run_pipeline could filter to, or reject, ids not in `{c.id for c in candidates}`.
- N3. `PipelineResult` is frozen, but its list fields are mutable. Shallow immutability only.
- N4. Only with an API key: an LLM narrative containing characters outside cp1252 crashes `print` when demo output is piped or redirected on Windows. Add `sys.stdout.reconfigure(errors="replace")` in `demo.main()`.
- N5. README does not mention `OPENAI_MODEL` (default `gpt-4o-mini`).
- N6. When both algorithms choose the same (candidate, posting) pair, `explain` runs twice for it (pipeline.py:58-70). With an LLM that doubles the narrative calls, and because `OpenAIClient.complete` has no `temperature=0`, the two narratives for the same pair can differ. A per-pair cache would fix both. Scores and allocations are unaffected.
- N7. With a key but no reachable endpoint, each LLM call took about 4.5 s before falling back (96 s for one 21-call pipeline run against a closed local port). The fallback is correct, but the demo would stall for minutes offline. Consider `max_retries=0` or a short connect timeout.
- N8. `scikit-learn` in requirements.txt is no longer imported directly. It stays as a transitive dependency of fairlearn, so it is harmless.
- Previously accepted and not re-raised: education-regex edge cases ("Scrum Master", "B.S.", "M.S.", "B-Tech") on the fallback path only; DOCX tables ignored; the `import fitz` FutureWarning.

## Spec coverage (sections 2, 3, 5, 9)
Milestone 1's scope is in place in `fairmatch/core`, with no web or DB imports:
- LLM-first parsing through a swappable `LLMClient` protocol, using OpenAI structured outputs with a JSON schema, `OPENAI_API_KEY`, and `OPENAI_MODEL` defaulting to gpt-4o-mini.
- spaCy PhraseMatcher fallback, flagged with `used_fallback`.
- PyMuPDF and python-docx file reading.
- Batched, cached `BAAI/bge-small-en-v1.5` embeddings.
- Hybrid scoring with validated, configurable weights (0.4/0.4/0.1/0.1) and taxonomy-aware exact and related skill credit.
- Hungarian with expanded seats via SciPy, and capacity-aware candidate-proposing Gale-Shapley, both deterministic with lower-index tie-breaks.
- Comparison of total score, blocking pairs and runtime, with fairness per algorithm at the pipeline level.
- Selection-rate parity, disparate-impact ratio under the four-fifths rule, and per-group mean score, cross-checked against Fairlearn.
- Grounded explanations with exact weighted contributions and an optional LLM narrative that never sees resume text.
- Protected labels reach only `fairness.audit`.

Every section 9 test this milestone owns is present and passes, and I re-verified them independently: capacity never exceeded, Hungarian equal to brute force, Gale-Shapley with zero blocking pairs, and Fairlearn agreement.

Deviations from spec wording, all settled by the plan and none missing an implementation the plan requires:
- The taxonomy is seeded from the prototype skill list, not an ESCO subset.
- spaCy is used for tokenisation and phrase matching, not NER.
- Fairlearn is a test oracle rather than a runtime dependency of the audit.
- Spec §5's `ParsedProfile` is folded into `Candidate`/`Posting`.
- Fairness is attached per algorithm in `PipelineResult`, not inside `AlgorithmResult`.

Spec §8's "validated up front" for seats = 0 or no candidates belongs to the API layer (Milestone 2); core already handles both cases without error.

## VERDICT: PASS_WITH_FIXES (2 blocking issues)
- B1: fairmatch/tests/conftest.py (and the `llm=None` calls at fairmatch/tests/test_pipeline.py:15,30,35,41,47,55). The fast suite makes live OpenAI calls whenever `OPENAI_API_KEY` is set. Fix: an autouse fixture that deletes `OPENAI_API_KEY` for tests not marked `llm` (code above).
- B2: fairmatch/README.md:40-50 and :56-57 keep stale TF-IDF-prototype claims: the "Ishaan, 0.759" score, and a "next step" to adopt Sentence-Transformers, which is already done. Fix: drop the TF-IDF bullet and rewrite the Hungarian paragraph without the hard-coded number (text above).
Both are small, test-only and doc-only changes. No core source change is required. After the fixes: re-run `python -m pytest -m "not slow and not llm" -q` and `python -m ruff check .`, then commit Task 11.
