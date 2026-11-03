# Judge re-check: Wave 2 fixes (parser education regex, line-wrap skills, LLM validation, NaN weights)

Date: 2026-11-03. Judge is read-only on source; all probes ran from the scratchpad
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\`.
Earlier verdict: `docs/superpowers/reports/judge-wave-2.md` (PASS_WITH_FIXES, 2 blocking issues in core/parser.py).

VERDICT: FAIL (1 blocking issue: education regex now misses "B Tech", "M Tech", "BE"; details at bottom)

## Check 1: suite, lint, shared files, layering

- `python -m pytest -m "not slow and not llm" -q` -> `101 passed, 2 deselected in 15.02s` (was 79 passed).
- `python -m ruff check .` -> `All checks passed!` (exit 0).
- `git diff --stat HEAD -- requirements.txt pyproject.toml tests/conftest.py core/models.py` -> empty;
  `git status --porcelain` on the same paths -> empty. `git diff --stat HEAD` (all tracked files) -> empty,
  so no committed file was touched; all Wave 2 work is in the untracked files listed in git status.
- `grep -rn "from app\|import app" core tests` -> no output, exit 1.

Result: PASS.

## Check 2: education regex (core/parser.py:44-56)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_edu.py`.
It runs 73 strings (28 requested positives, 21 negatives, 24 realistic degree phrasings) through
`_regex_education`, `parse_candidate(..., llm=None).education_level` and
`parse_posting(..., llm=None).min_education_level`. All three agree for every string (asserted). It also
runs the pre-fix regexes (copied from the earlier probe `probe_edu_sample.py`) to find regressions.

Totals: 73 cases, 18 wrong (positives 2/28, negatives 4/21, realistic 12/24); **5 regressions**, 14 fixed.

Original blocking FPs, all fixed now (new -> 0; pre-fix value in brackets): `I want to be a developer` [2],
`you will be joining our team` [2], `system technician` [3], `platform technologies` [3],
`team tech lead` [3], `graphdb expert` [4], `orphdb admin` [4], `mastered git` [3],
`bachelorette party planner` [2], `Plumb tech crew` [2], `web tech stack` [2], `we use mtechs tools` [3].
`maybe later`, `smcache and dmcards`, `beta tester`, `embassy liaison` -> 0 (were 0 already). Also newly
correct: `Ph. D. in Chemistry` and `Ph D` -> 4 (pre-fix 0).

Correct positives: B.Tech, `B. Tech`, BTech, `B.E.`, `B.E`, `B.E.(Hons)`, `B.TECH`, Bachelor of Engineering,
Bachelor's, Bachelors, `Bachelor’s` (curly), BCA, B.Sc, BSc, M.Tech, MTech, `M. Tech`, MCA, Master's, Masters,
`Master’s`, Master of Science, M.Sc, MSc, MBA, `MBA/PGDM`, PhD, PHD, Ph.D., Ph.D, Doctorate, multi-line
`Education:\nB.Tech\nComputer Science`; highest level wins (`Bachelor's or Master's` -> 3, `Masters or PhD` -> 4).

Every wrong result (expected / got / pre-fix):

| text | exp | new | pre-fix | note |
|---|---|---|---|---|
| `BE degree in Computer Engineering` | 2 | 0 | 2 | **REGRESSION** |
| `BE (Computer Engineering), 2023` | 2 | 0 | 2 | **REGRESSION** |
| `BE in Information Technology` | 2 | 0 | 2 | **REGRESSION** |
| `B Tech in Computer Science` | 2 | 0 | 2 | **REGRESSION** |
| `M Tech in Data Science` | 3 | 0 | 3 | **REGRESSION** |
| `Diploma in Computer Engineering` | 1 | 0 | 0 | gap, not in plan's regex list |
| `Scrum Master` | 0 | 3 | 3 | pre-existing FP |
| `Certified Scrum Master (CSM)` | 0 | 3 | 3 | pre-existing FP |
| `Work with the Scrum Master and Product Owner` | 0 | 3 | 3 | pre-existing FP (posting -> min edu 3) |
| `merged into the master branch` | 0 | 3 | 3 | pre-existing FP |
| `B Sc Computer Science` / `M Sc Physics` | 2 / 3 | 0 | 0 | pre-existing gap |
| `B-Tech in CSE` | 2 | 0 | 0 | pre-existing gap |
| `B.S.` / `BS` / `M.S.` / `MS in Computer Science` | 2/2/3/3 | 0 | 0 | pre-existing gap (US style) |
| `M.E. in Structural Engineering` | 3 | 0 | 0 | pre-existing gap |

Regression ruling: the fix made the dot mandatory in `m\.\s?tech` / `b\.\s?tech` (parser.py:45-46) and in
`b\.\s?e`. "B Tech", "M Tech" and "BE" (no dots) are standard phrasing on Indian resumes (the sample data's
own market), and on the default no-key path such a candidate now scores education 0 instead of 2/3. The
dot was not needed for B/M Tech: word-anchoring alone kills every FP above. The "BE" loss follows the
earlier judge's own suggested fix ("require the dot in B.E"); that spec was too strict and is amended here.

Candidate fix, checked in
`C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_edu_alt.py`
(same 73 strings + 7 extra edge cases): recovers all 5 regressions, introduces no new wrong result in the
73-case table, keeps `I'm tech-savvy` / `I’m tech savvy` / `to be determined` / `Be a team player` at 0.
Remaining costs: `Plan B tech demo` -> 2 and all-caps `MUST BE ABLE TO RELOCATE` -> 2 (both rare).

```python
_MASTER = re.compile(r"(?<![\w'\u2019])m\.?\s?tech\b|\bmasters?\b|\bmca\b|\bm\.\s?sc\b|\bmsc\b|\bmba\b", re.IGNORECASE)
_BACH = re.compile(r"\bb\.?\s?tech\b|\bbachelors?\b|\bb\.\s?e\b|\bb\.\s?sc\b|\bbsc\b|\bbca\b", re.IGNORECASE)
_BE_UPPER = re.compile(r"\bBE\b")  # case-sensitive: the degree acronym, not the verb "be"
# in _regex_education: if _BACH.search(text) or _BE_UPPER.search(text): return 2
```

Result: original FP issue FIXED; new **BLOCKING** regression (B Tech / M Tech / BE no longer detected).
Non-blocking: Scrum Master / master branch FP (pre-existing, also in the earlier report's table), diploma
-> 0 (LLM path returns 1 for diploma, fallback returns 0), US-style B.S./M.S. gaps.

## Check 3: multi-word skills across line wraps (core/parser.py:30)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_wrap.py`.
The fix is `doc = _nlp(" ".join(text.split()))`; `raw_text` is stored untouched (asserted for every
sample item). The script also emulates the pre-fix code (same matcher, `_nlp(text)` with no
normalisation) so new vs old can be compared on the sample data after all.

Sample data (`fairmatch/sample_data`, 6 resumes + 5 postings, `llm=None`):
- Gained vs pre-fix: Aarav `machine learning`, Rohan `deep learning`, Ishaan `data analysis`,
  AI Research Intern `computer vision`. All 4 targets present.
- Lost vs pre-fix: **none** (every skill found before is still found, for all 11 texts).
- `parse_candidate(...).skills` / `parse_posting(...).required_skills` equal `extract_skills_spacy` output.

Taxonomy sweep (67 terms from `core/data/skills.json` incl. aliases; 12 multi-word):
- 268 plain-context checks (sentence, bare term, after `Skills:\n` with trailing comma, in parentheses):
  0 failures.
- 144 whitespace checks (each multi-word term with its words joined by `\n`, double space, tab,
  `\n` + 12-space indent, `\r\n`, ` \t\n `; both mid-sentence and with the separator around the term):
  0 failures.
- 48 split checks (words separated by `and`, `of the`, `x`, `\n- \n`): 0 false matches, so a skill is NOT
  matched when other words sit between its words.

Extra probes: `machine\n    learning`, `deep\n   learning`, `natural language\n processing`,
`natural\tlanguage\n\nprocessing`, `spring\nboot`, NBSP and em-space -> matched. `machine-\nlearning`
(hyphenated wrap) and zero-width space -> `()` (acceptable). `python;docker`, `C++,Java` -> `()` (minor,
noted earlier, unchanged). Regression tests exist: tests/test_parser.py:105 (`machine\nlearning`,
`deep   learning`) and :110 (sample Aarav/Rohan).

Result: PASS. Blocking issue #2 is FIXED. Note only: collapsing paragraph breaks can join the last word
of one line with the first of the next (e.g. `big data\n\nScience Olympiad` -> `data science`); rare.

## Check 4: LLM-output validation (core/parser.py:59-82)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_llm.py`.
A raw client returns each object verbatim (`FakeLLMClient` swaps falsy profiles for a default, so it
cannot send `None`/`{}`). Text: `"Python developer with 4 years using Docker. B.Tech in CS."`; `llm=None`
reference = `(('docker','python'), 4, 2)`. Each profile goes through `parse_candidate` AND `parse_posting`.

30 profiles, **0 crashes, 0 wrong results**:
- Fallback (`used_fallback=True`, values equal the `llm=None` reference), 22 cases: skills as string /
  ints / mixed `["python",3,None]` / `None` / dict; profile `None`, `{}`, a list, a str; years float `3.9`,
  str `"4"`, `True`, NaN, inf, `None`, `np.int64(5)`; education `"3"`, `False`, `2.0`; missing `skills`,
  missing `experience_years`, missing `education_level`.
- Accepted (`used_fallback=False`), 8 cases: years `-3` -> 0; education `9` -> 4, `-1` -> 0; extra keys
  ignored; tuple skills with alias/unknown/blank `("React","  Python ","cobol-ish","")` ->
  `('python','react.js')`; empty skills list -> `()`; valid profile unchanged; years `10**20` kept.
- Every result: `experience_years >= 0`, `0 <= education_level <= 4`, both `int`; posting fields equal the
  candidate fields.

Result: PASS. The earlier non-blocking note (string skills accepted, no clamping) is resolved. Notes only:
no upper cap on years (`10**20` kept; harmless for scoring, which caps at 1.0); floats are rejected
outright rather than truncated, which is fine because `OpenAIClient.extract_profile` (core/llm.py) already
coerces to `int`.

## Check 5: ScoreWeights NaN/inf (core/scoring.py:19-26)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_weights.py`.
- `ValueError("weights must be finite")` for NaN in each of the 4 positions, all-NaN, `+inf`, `-inf`,
  `(-inf, inf, .5, .5)`, `np.float64('nan')`, `np.float64('inf')` (11 cases). Old rules intact: sum 1.2 ->
  "must sum to 1.0", `-0.1` -> "must be non-negative", `+1e-8` drift rejected, `+1e-10` accepted.
- Accepted: `ScoreWeights()` = `(0.4, 0.4, 0.1, 0.1)`, `(1,0,0,0)`, `(.25,.25,.25,.25)`, `(.1,.2,.3,.4)`,
  `np.float64(0.4)` mix. Still frozen (`FrozenInstanceError`), still truthy.
- A string weight raises `TypeError` from `math.isfinite`, not `ValueError` (outside the plan's contract;
  note only).
- `score_matrix` signature unchanged: `(candidates, postings, embedder, taxonomy=None, weights=None)`
  with the same annotations and return type as in the earlier report.
- Regression tests exist: tests/test_scoring.py:76 (NaN) and :81 (inf).

Result: PASS (earlier non-blocking NaN gap resolved).

## Check 6: cross-module smoke (parse -> score_matrix -> both algorithms -> compare -> explain -> audit)

Script: `C:\Users\Sejal\AppData\Local\Temp\claude\c--Users-Sejal-Downloads-FairMatch-AI-Project\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\recheck2_smoke.py`
(`fairmatch/sample_data`, `tests.conftest._FakeEmbedder`, ids `c1..`/`p1..`, groups alternating). Runs to
`SMOKE OK`, no exception. Asserted on every run and both algorithms: `compare_algorithms` allocation equals
the direct `hungarian` / `gale_shapley` call; **no posting over capacity**; no candidate assigned twice;
assignments + unallocated partition the candidates; `blocking_pairs` equals an independent reference count;
`total_score` equals the matrix sum; every assignment has an explanation with matching ids and
`assignment.score == breakdown.total`; `audit` runs; matrix has no NaN.

- Default run (6 x 5, cap 1): parsed skills now include Aarav `machine learning`, Rohan `deep learning`,
  Ishaan `data analysis`, AI Research Intern `computer vision`. Hungarian and GS: total 4.4346, 0 blocking
  pairs, load 1 per posting, `c1` unallocated, DI 0.667.
- Capacities `[0,0,0,0,0]` -> total 0, 6 unallocated; `[0,3,0,1,10]` -> load `{p5:4, p2:1, p4:1}`, 0
  unallocated; `[2,2,2,2,2]` -> `p1` holds 2; `[1,0,1,0,1]` -> 3 unallocated. 0 blocking pairs for GS.
- 40 seeded runs with random capacities 0..3 and random weights: all assertions hold; GS blocking pairs
  total 0; Hungarian total >= GS total in every run.
- Resumes re-wrapped with newlines and double spaces -> identical parsed skills.
- `FakeLLMClient(profile, completion="Narrative.")` -> all explanations `used_fallback=False`;
  `FakeLLMClient(raises=True)` + `ScoreWeights(.25,.25,.25,.25)` -> all fall back, no error; garbage profile
  (`skills="python"`) -> parser falls back, pipeline completes.

Result: PASS.

---

## VERDICT: FAIL (1 blocking issue)

The two original blocking issues are fixed: every listed education false positive now returns 0
(Check 2), and multi-word skills match across newlines, tabs and repeated spaces with nothing lost on the
sample data (Check 3). LLM-profile validation (Check 4) and NaN/inf weight rejection (Check 5) are correct,
and the suite, lint, shared files, layering and the end-to-end smoke are all green (Checks 1 and 6). The
education fix went too far, though: it now misses common degree spellings that the old regex caught.

### Per-issue status

| # | Earlier issue | Status |
|---|---|---|
| B1 | Education regex false positives (parser.py) | FIXED (all 12 listed FPs -> 0) |
| B2 | Multi-word skills lost across line wraps (parser.py:30) | FIXED (0 failures in 460 checks, 0 skills lost) |
| NB | LLM values not validated or clamped | FIXED |
| NB | NaN weights accepted (scoring.py) | FIXED |

### Blocking issues (1, new)

1. **Education regex regression: "B Tech", "M Tech" and "BE" no longer detected**, core/parser.py:45-46.
   The fix made the dot mandatory (`\bm\.\s?tech\b`, `\bb\.\s?tech\b`, `\bb\.\s?e\b`). `B Tech in Computer
   Science` -> 0 (was 2), `M Tech in Data Science` -> 0 (was 3), `BE degree in Computer Engineering`,
   `BE (Computer Engineering), 2023`, `BE in Information Technology` -> 0 (were 2). These are standard on
   Indian resumes (the sample data's market). On the default no-key path, a candidate who writes "B Tech"
   scores lower than one who writes "B.Tech" against any posting that names a degree. That is a
   formatting-style bias in a fairness tool. The "BE" part comes from the earlier judge's own suggested
   fix, which was too strict.
   Fix (checked on all 80 probe strings, the existing parametrised tests and the sample data; recovers all 5,
   no new wrong results in the main table):
   ```python
   _MASTER = re.compile(r"(?<![\w'\u2019])m\.?\s?tech\b|\bmasters?\b|\bmca\b|\bm\.\s?sc\b|\bmsc\b|\bmba\b", re.IGNORECASE)
   _BACH = re.compile(r"\bb\.?\s?tech\b|\bbachelors?\b|\bb\.\s?e\b|\bb\.\s?sc\b|\bbsc\b|\bbca\b", re.IGNORECASE)
   _BE_UPPER = re.compile(r"\bBE\b")  # case-sensitive: the degree acronym, not the verb "be"
   # _regex_education: if _BACH.search(text) or _BE_UPPER.search(text): return 2
   ```
   Add to the parametrised test at tests/test_parser.py:94: `("B Tech in CSE", 2)`, `("M Tech", 3)`,
   `("BE in IT", 2)`, `("BE degree", 2)`, `("I'm tech-savvy", 0)` (keep `("I want to be a developer", 0)`).

### Non-blocking notes

- core/parser.py:45 `\bmasters?\b` still matches `Scrum Master`, `Certified Scrum Master`, `master branch`
  (pre-existing, in the earlier report's table). A posting that says "work with the Scrum Master" gets
  `min_education_level=3`. Suggest `(?<!scrum\s)\bmasters?\b(?!\s+branch)`.
- Diploma -> 0 on the fallback path, while the LLM prompt (core/llm.py) maps diploma to 1. Suggest
  `\bdiploma\b` -> 1. US-style `B.S.`/`M.S.`/`M.E.`, `B Sc`/`M Sc` (with a space) and `B-Tech` are not
  detected (pre-existing gaps).
- No upper cap on LLM `experience_years` (`10**20` kept); harmless for scoring.
- `ScoreWeights("0.4", ...)` raises `TypeError` rather than `ValueError` (outside the plan's contract).
- Whitespace normalisation can join words across a paragraph break (`big data\n\nScience` ->
  `data science`); rare.
- Earlier notes still open: `import fitz` FutureWarning (parser.py:105), DOCX tables ignored, UTF-8 BOM
  kept, `python;docker` / `C++,Java` -> `()`.
