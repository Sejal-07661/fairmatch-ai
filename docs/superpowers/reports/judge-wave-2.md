# Judge report: Wave 2 (Tasks 4, 6, 8, 10)

Date: 2026-11-03. Judge is read-only on source; all probes ran from scratchpad.

VERDICT: PASS_WITH_FIXES (2 blocking issues, both in core/parser.py; details at bottom)

## Check 1: suite, lint, shared files, layering

- `python -m pytest -m "not slow and not llm" -q` -> `79 passed, 2 deselected in 14.50s`.
- `python -m ruff check .` -> `All checks passed!` (exit 0).
- `git diff --stat HEAD -- requirements.txt pyproject.toml tests/conftest.py core/models.py` -> empty;
  `git status --porcelain` on the same paths -> empty. Shared files unmodified.
- `grep -rnE "from app|import app" core tests` -> no matches (exit 1).
- Note: `requirements.txt` at HEAD already lists `pymupdf` and `python-docx`, so the Task 4 report's
  concern ("not added to requirements.txt") is moot.

Result: PASS.

## Check 2: interfaces vs plan

Evidence: `inspect.signature` on every public name (output reproduced in short form):

| Plan name | Implementation | Status |
|---|---|---|
| `extract_skills_spacy(text, taxonomy) -> tuple[str, ...]` | core/parser.py:27, same | OK |
| `parse_candidate(id, name, text, llm=None, taxonomy=None) -> Candidate` | core/parser.py:69, same | OK |
| `parse_posting(id, title, text, capacity, llm=None, taxonomy=None) -> Posting` | core/parser.py:76, same | OK |
| `read_resume_file(path: Path) -> str` | core/parser.py:85, same; text accepted for `.txt`/`.md`, anything else raises `ValueError` | OK (reasonable reading of "else UTF-8 text; unknown suffix raises") |
| `ScoreWeights(0.4, 0.4, 0.1, 0.1)` frozen, validated | core/scoring.py:11-23 | OK (see NaN note) |
| `skill_overlap(candidate_skills, required_skills, taxonomy) -> (float, tuple, tuple)` | core/scoring.py:30, same params and return, no type hints | OK (cosmetic: missing annotations) |
| `score_matrix(candidates, postings, embedder, taxonomy=None, weights=ScoreWeights())` | core/scoring.py:61-67, `weights: ScoreWeights \| None = None` | DEVIATION, ruled equivalent (below) |
| `count_blocking_pairs(allocation, candidates, postings, scores) -> int` | core/compare.py:19 | OK |
| `AlgorithmResult(allocation, total_score, blocking_pairs, runtime_ms)` frozen | core/compare.py:11 | OK |
| `compare_algorithms(candidates, postings, scores) -> dict[str, AlgorithmResult]` over `ALGORITHMS` | core/compare.py:50 | OK |
| `Explanation(candidate_id, posting_id, reasons, narrative, used_fallback)` frozen | core/explain.py:11 | OK |
| `explain(breakdown, candidate, posting, weights: ScoreWeights, llm=None) -> Explanation` | core/explain.py:37 | OK (weights required, as in plan) |

Rules checked against code:
- Parser: LLM skills mapped through `taxonomy.canonical`, unknowns dropped (parser.py:60); any exception -> spaCy +
  regex, `used_fallback=True` (parser.py:63-66); `llm=None` -> fallback True; postings discard the flag
  (parser.py:79). Matches.
- Scoring: exact 1.0 / related 0.5 / else 0, ratio over required count, 0.0 if none (scoring.py:30-48);
  experience `min(1, years/min)`, 1.0 at min 0 (scoring.py:51-52); education rule (scoring.py:55-58);
  semantic clipped to [0,1] with NaN -> 0 (scoring.py:78); totals rounded to 6 dp and equal to the matrix
  (scoring.py:87-93); two batched `encode` calls + one `cosine_matrix` (scoring.py:74-77). Matches.
- Compare: blocking definition implemented literally, capacity-0 postings skipped (compare.py:37-46);
  `time.perf_counter` around each algorithm (compare.py:55-57). Matches.
- Explain: one reason per signal with weighted contribution + one per related pair (explain.py:20-34);
  prompt holds only reasons + `candidate.name` + `posting.title` (explain.py:48-52); fallback on None,
  exception, or blank completion (explain.py:46-58). Matches.

Deviations (none blocking):
1. core/scoring.py:66,69 `weights: ScoreWeights | None = None` then `weights = weights or ScoreWeights()`.
   RULING: behaviourally equivalent. `ScoreWeights` defines no `__bool__`/`__len__`, so every instance is
   truthy (probe: `bool(ScoreWeights()) -> True`); omitting the argument or passing any instance gives the
   same result as the plan signature; passing `None` is a strict superset. Callers are unaffected:
   `explain()` never calls `score_matrix` and takes its own required `weights`; Task 11 passes a concrete
   `ScoreWeights` either way. Accept as is.
   ADVISORY for Task 11: the plan's pinned `run_pipeline(..., weights: ScoreWeights = ScoreWeights())`
   itself trips ruff B008 under this repo's ruff 0.17.3 config (probe file
   `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\b008_probe.py` -> `B008 Do not perform function call ScoreWeights in argument defaults`, exit 1).
   Task 11 should use the same `None`-default pattern (or a module-level `DEFAULT_WEIGHTS`) and MUST
   resolve `None` to `ScoreWeights()` before calling `explain()`, which does not accept `None`
   (explain.py:30 would raise `AttributeError` on `weights.semantic`).
2. core/explain.py:30 contributions printed with 4 decimals (`0.2667`) rather than the plan example's 2
   (`0.27`). Justified: 4 x 0.005 rounding at 2 dp could miss the plan's own 1e-3 sum test. Cosmetic side
   effect: the line shows `0.67 x 0.4 = 0.2667` because the value is shown at 2 dp but multiplied at full
   precision.
3. core/parser.py:44-52 education regex is broader than the plan (adds doctorate, M.Sc, MBA, B.E, B.Sc,
   BCA). Allowed in spirit, but it introduces false positives, see Check 3.

Result: PASS (no interface mismatch that breaks Task 11's pinned calls).

## Check 3: parser probes

Scratch scripts (full paths):
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_parser.py`,
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_edu_sample.py`,
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_edu_fix.py`.

Real files:
- PDF built with PyMuPDF (2 pages): `read_resume_file` returned
  `'Aarav Sharma\nPython developer with 4 years using FastAPI, Docker and PostgreSQL.\n\nSecond page: Kubernetes and React\n'`;
  skills `('docker','fastapi','kubernetes','postgresql','python','react.js')`. `str` path and `.PDF`
  upper-case suffix both work.
- DOCX built with python-docx: paragraphs returned verbatim incl. non-ASCII `Dévéloppeur 日本語`.
  Table cell text (`Kubernetes, MongoDB`) is NOT returned (only `doc.paragraphs` is read).
- `.txt` UTF-8: round-trips exactly.
- `.xyz`, no suffix, `.doc`, `.rtf` -> `ValueError: Unsupported file type: ...`. OK.
- Non-existent path: `.pdf` -> `FileNotFoundError` (pymupdf), `.txt` -> `FileNotFoundError`, `.docx` ->
  `docx.opc.exceptions.PackageNotFoundError` (inconsistent type). Corrupt PDF -> `FileDataError`; corrupt
  DOCX -> `PackageNotFoundError`; latin-1 `.txt` -> `UnicodeDecodeError`; UTF-8-BOM `.txt` keeps `\ufeff`.
- `import fitz` emits `FutureWarning: The fitz API is deprecated ... Use import pymupdf` (parser.py:89).

parse_candidate:
- `llm=None` and `FakeLLMClient(raises=True)` -> `('docker','fastapi','postgresql','python')`, exp 4,
  `used_fallback=True`. OK.
- Garbage LLM profiles, 17 variants: NO crash in any case. Fallback (`True`) for `None`, `{}`, missing
  `skills`/`experience_years`, `skills=None`, `skills=5`, `experience_years="five"`/`None`/`NaN`. Accepted
  with `used_fallback=False`: `experience_years="4"` -> 4, `3.9` -> 3, `skills=[None,"Python",3]` ->
  `('python',)`, `skills={"python":1}` -> `('python',)`.
  Questionable but non-crashing: `skills="python, docker"` -> `skills=()`, `used_fallback=False`
  (iterates characters); `experience_years=-3` stored as -3; `education_level=99` / `-1` stored as is.
- Empty / whitespace / `Dévéloppeur 日本語` / `Ünïcödé Pythön` -> `skills=()`, fallback True. Emoji and
  Cyrillic around `python` still find `python`. `parse_posting("p","t","",0)` -> empty posting, no crash.
- `"express interest in vue"` -> `('vue.js',)` (no `express.js`; taxonomy has only `express.js`/`expressjs`).
  `"I will express my interest"` -> `()`. `"Express.js and Vue.js"` -> both. OK.

Education/experience regex (`_regex_education`, parser.py:44-52), observed:

| text | level |
|---|---|
| `I want to be a developer` | 2 |
| `will be joining` | 2 |
| `team tech lead` | 3 |
| `platform technologies` | 3 |
| `system technician` | 3 |
| `graphdb expert` | 4 |
| `scrum master` / `mastered git` | 3 |

`\bb\.?e\b` (line 50) matches the English word "be"; unanchored `m\.?\s?tech` (line 48) matches
"platfor**m tech**nologies"/"tea**m tech**"; unanchored `ph\.?d` (line 46) matches "gra**phd**b". This is
the default (no API key) path for BOTH candidates and postings: a posting that says "you will be ..."
gets `min_education_level=2`, so every candidate without a degree keyword loses the full education
term. Sample data is unaffected (only Aarav hits, via `b.tech`), which is why tests pass.
`_regex_experience`: `"2023 years"` -> 2023, `"10 yrs"` -> 0 (minor).

Result: FAIL on one item (education regex false positives, BLOCKING #1); everything else PASS.

## Check 4: scoring probes (fake embedder = `tests.conftest._FakeEmbedder`)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_scoring.py`.

- Random 30 candidates x 12 postings (random taxonomy skills, empty and non-ASCII texts, negative years,
  education -1..5, minimums -1..6): shape `(30, 12)`, breakdowns 30 rows of 12, no NaN, range
  `0.0 .. 0.882843`, matrix equals every `breakdown.total`, all five components in [0,1], ids aligned,
  `total == round(0.4*sem + 0.4*skill + 0.1*exp + 0.1*edu, 6)` for every cell.
- Determinism: two runs identical (arrays and breakdowns). `weights` omitted / `None` / `ScoreWeights()`
  give identical output (supports the Check 2 ruling).
- Extreme weights `(1,0,0,0)`, `(0,1,0,0)`, `(0,0,.5,.5)`, `(.1,.2,.3,.4)`: totals stay in [0,1], no NaN.
- Weights validation: `(0.5,0.5,0.1,0.1)` -> ValueError sum; `(-0.1,0.6,0.4,0.1)` -> ValueError
  non-negative; `+1e-10` drift accepted, `+1e-8` rejected (tolerance 1e-9 as specified); `inf` rejected.
  GAP: `ScoreWeights(nan, 0.4, 0.1, 0.1)` and all-NaN are ACCEPTED (scoring.py:20-22: `nan < 0` and
  `abs(nan-1) > 1e-9` are both False). Downstream `allocation._prepare` then raises
  `ValueError: scores must be finite`, so it fails loudly, not silently. Non-blocking.
- Empty inputs: `(0,0)->[]`, `(0,3)->[]`, `(4,0)->[[],[],[],[]]`. OK.
- skill_overlap: exact `(1.0, ('machine learning',), ())`; related
  `(0.5, (), (('machine learning','artificial intelligence'),))` (pair is (required, candidate)); none 0.0;
  2 required mixed exact+related -> 0.75; alias `React` vs `react.js` -> 1.0; exact match is not
  double-counted with a related hit; no required -> `(0.0, (), ())`; no candidate skills -> 0.0.
- `min_experience_years=0` -> experience 1.0 for 0 and 1 years; 1 of 2 years -> 0.5; edu 2 of 3 -> 0.6667;
  min 0 education -> 1.0.
- Posting with no required skills: every candidate gets skill 0.0, so the posting's totals are capped at
  0.6 under default weights. This is the plan's rule ("0.0 if none required") but it biases Hungarian
  against such postings in cross-posting comparisons. Note only.
- Adversarial embedder (NaN row, unnormalised vectors): NaN -> semantic 0.0, >1 clipped to 1.0, no NaN in
  matrix.

Result: PASS (NaN-weight gap is non-blocking).

## Check 5: compare probes (300 seeded cases)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_compare.py`.

Six case families x 50 seeds: tiny n (0-1), tiny m (0-1), all capacities 0, first capacity 0, heavy
ties (scores in {0,1/3,2/3,1}), all-equal 0.5 matrix; n in 0..11, m in 0..5, capacity 0..3. Coverage:
94 cases with empty candidates or postings, 159 with at least one zero-capacity posting.

For every case and both algorithms (asserted, all passed):
- `count_blocking_pairs` equals an independent reference implementation of the plan definition.
- no posting over capacity; no candidate assigned twice; assignments + unallocated partition the ids.
- `total_score` equals the sum of matrix entries of the assignments; `runtime_ms >= 0`.

Results: Gale-Shapley blocking pairs != 0 in **0 / 300** cases. Hungarian total below GS in **0 / 300**
(`min(Hungarian - GS) = 0.0`); Hungarian vs unbiased `linear_sum_assignment` optimum gap
`<= 8.9e-16`. Hungarian had blocking pairs in 7 cases (expected, it optimises total, not stability).

Hand cases: plan's known blocking pair -> 1 (reference 1); unallocated candidate + free seat -> 1;
equal scores do not block -> 0; `[]`/`[]`, zero postings, zero candidates, all-capacity-0 -> no error,
total 0.0, blocking 0, all candidates unallocated. Instability example `[[.9,.8],[.85,.1]]`:
Hungarian total 1.65 with 1 blocking pair vs GS 1.0 with 0.

Result: PASS.

## Check 6: explain probes

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_explain.py`.

- 200 random breakdowns (random weights summing to 1 incl. zeros, components in [0,1] incl. all-0 and
  all-1, 0-3 matched skills, 0-2 related pairs): contributions parsed from each reason line sum to
  `breakdown.total` with max error **1.47e-4** (limit 1e-3). Reason count = 4 + related pairs every time.
  Reasons identical with and without an LLM (deterministic).
- Recording fake (subclass of `FakeLLMClient`): over 200 prompts, **0 leaks** of `candidate.raw_text`,
  `posting.raw_text`, or distinctive fragments of them (address, phone, "gender", "salary band",
  "hiring manager"). The prompt holds exactly the instruction, `candidate.name`, `posting.title` and the
  reason lines.
- Fallbacks: `llm=None`, `raises=True`, `completion=""`, whitespace-only completion, `complete()` returning
  `None` / `5` / a list, `complete()` raising `ValueError` -> `used_fallback=True`, narrative = reasons joined
  with `"; "` + `"."`. A real completion `"  Fine. \n"` -> `"Fine."`, `used_fallback=False`.
  `KeyboardInterrupt` propagates (correct: only `Exception` is caught).
- Zero-score / no-matched-skills breakdown: 4 lines, all `= 0.0000`, `(matched: none)`, no related lines.
- `explain(..., weights=None)` -> `AttributeError` (see Check 2 advisory for Task 11).
- Cosmetic: the value is shown at 2 dp and the contribution at 4 dp from full precision, e.g.
  `Semantic similarity 0.76 x 0.422546 = 0.3203`; weights are shown with `:g` (6 significant digits).

Result: PASS.

## Check 7: cross-module smoke (parse -> score_matrix -> both algorithms -> compare -> explain -> audit)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\smoke_pipeline.py`
(uses `fairmatch/sample_data`, `tests.conftest._FakeEmbedder`, ids `c1..`/`p1..`, demo groups alternating).

- Runs to `SMOKE OK` with no exception. 6 candidates x 5 postings (cap 1 each): Hungarian and GS both
  total 4.4346, 0 blocking pairs, load 1 per posting, `c1` unallocated; `compare_algorithms` allocations
  equal direct `hungarian`/`gale_shapley` calls; every assignment has an explanation with matching ids
  and `assignment.score == breakdown.total`; `audit` runs (DI 0.667).
- Capacity variants `[0,0,0,0,0]` (all 6 unallocated, total 0), `[0,3,0,1,10]` (more seats than
  candidates), `[2,2,2,2,2]`: no posting exceeds capacity, GS 0 blocking pairs in each.
- `FakeLLMClient(profile=..., completion="Narrative.")`: all explanations `used_fallback=False`;
  `FakeLLMClient(raises=True)` with `ScoreWeights(.25,.25,.25,.25)`: all fall back, no error.

Parser recall defect found while reading the smoke output: multi-word skills that wrap across a line
(or contain a double space) are never matched, because spaCy's tokenizer emits a whitespace token
between the words and the `PhraseMatcher` pattern has none. Probe:
`'machine learning' -> ('machine learning',)` but `'machine  learning'`, `'machine\nlearning'`,
`'deep\n   learning'`, `'natural language\n processing'` -> `()`. On the sample data this drops
`machine learning` (Aarav), `deep learning` (Rohan), `data analysis` (Ishaan) and `computer vision`
from the AI Research Intern posting; normalising whitespace recovers all four and loses nothing
(also checked: `test_word_boundary_no_substring_match` input still gives `()`). PyMuPDF output (Check 3)
is newline-separated, so real PDF resumes hit this constantly. Inherited from `app/parser.py`, but Task 4
owns `extract_skills_spacy` now. Minor, same area: `'python;docker'` and `'C++,Java'` -> `()`.

Result: PASS on wiring and capacity; parser recall defect = BLOCKING #2.

---

## VERDICT: PASS_WITH_FIXES

Interfaces match the plan's pinned signatures (the one deviation is ruled equivalent), the suite and
lint are green, compare and explain are solid, scoring is correct. Two small parser fixes are needed
before the Wave 2 commit, because Task 11's demo runs the no-key fallback path on exactly these inputs.

### Blocking issues (2)

1. **Education regex false positives**, core/parser.py:46, :48, :50.
   `\bb\.?e\b` matches the word "be"; unanchored `m\.?\s?tech` matches "platfor-m tech-nologies",
   "tea-m tech"; unanchored `ph\.?d` matches "gra-phd-b". Result: `"you will be ..."` -> 2,
   `"platform technologies"` / `"system technician"` -> 3, `"graphdb"` -> 4, for candidates AND postings
   (`min_education_level`) on the fallback path.
   Fix (checked in `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\probe_edu_fix.py`:
   all 16 probe strings correct, plan cases kept):
   ```python
   if re.search(r"\bph\.?\s?d\b|\bdoctorate\b", t):
       return 4
   if re.search(r"\bm\.?\s?tech\b|\bmaster|\bmca\b|\bm\.?sc\b|\bmba\b", t):
       return 3
   if re.search(r"\bb\.?\s?tech\b|\bbachelor|\bb\.e\b|\bb\.?sc\b|\bbca\b", t):
       return 2
   return 0
   ```
   (i.e. word-anchor every pattern and require the dot in `B.E`). Add a regression test:
   `parse_candidate("c","n","I want to be a developer on platform technologies").education_level == 0`.

2. **Multi-word skills split by line breaks or repeated spaces are missed**, core/parser.py:30.
   Fix: `doc = _nlp(" ".join(text.split()))` (normalise whitespace before matching; `raw_text` stays
   untouched). Add a regression test: `extract_skills_spacy("machine\n    learning", TAX) == ("machine learning",)`.
   Recovers 4 sample-data skills, loses none.

### Non-blocking notes

- core/scoring.py:66 `weights=None` default: behaviourally equivalent to the plan, accept. Task 11 should
  copy this pattern (the plan's `weights: ScoreWeights = ScoreWeights()` default fails ruff B008 here) and
  must resolve `None` before calling `explain()`, which requires a real `ScoreWeights` (explain.py:30).
- core/scoring.py:20-22 NaN weights pass validation (`nan < 0` and `abs(nan-1) > 1e-9` are False).
  Suggest `if not all(math.isfinite(w) and w >= 0 for w in ws)` and `if not abs(sum(ws) - 1.0) <= 1e-9`.
  Fails loudly later in `allocation._prepare`, so not silent.
- core/parser.py:60-62 trusts LLM values without range checks: `skills="python, docker"` -> `()` with
  `used_fallback=False`; `experience_years=-3` and `education_level=99`/`-1` stored as is. Suggest
  `if not isinstance(prof["skills"], list): raise TypeError` and clamping years to `>= 0`, education to
  `0..4`. Real `OpenAIClient` returns schema-shaped data, so low risk today.
- core/parser.py:89 `import fitz` emits a PyMuPDF `FutureWarning`; use `import pymupdf`.
- core/parser.py:96 DOCX table cells are ignored (skills tables are common); consider also iterating
  `doc.tables`. core/parser.py:98 use `encoding="utf-8-sig"` to drop a BOM. Missing `.docx` raises
  `PackageNotFoundError` instead of `FileNotFoundError`; non-UTF-8 `.txt` raises `UnicodeDecodeError`
  (the API milestone will need to map both to 422).
- core/parser.py:40 `_regex_experience` takes the max number before "year(s)" (`"2023 years"` -> 2023,
  `"10 yrs"` -> 0). Consider a sanity cap.
- core/scoring.py:30 `skill_overlap` has no type annotations (plan lists types).
- core/explain.py:30 contributions at 4 dp vs the plan's 2-dp example: justified by the 1e-3 sum rule;
  cosmetic mismatch `0.67 x 0.4 = 0.2667`.
- Postings with no required skills cap every candidate at 0.6 under default weights (plan rule as
  written); worth a spec note before the UI milestone.
- Task 4 report's requirements.txt concern is moot (`pymupdf`, `python-docx` already in HEAD).
