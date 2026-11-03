# Task 11 report

Added core/pipeline.py (run_pipeline, PipelineResult) via TDD (red: ModuleNotFoundError; then 9 pipeline tests pass), migrated demo.py and README.md, deleted fairmatch/app/ and the ruff extend-exclude line.

- Tests: 115 passed, 2 deselected (not slow and not llm); ruff clean including demo.py.
- demo.py ran clean (rc 0) before and after deleting app/; output identical apart from runtime.
- Demo output: 6 candidates / 5 postings with extracted skills; score table; hungarian and gale_shapley both total 4.686, 0 blocking pairs, Aarav unallocated; fairness (demo-only alternating groups) DI 0.67, four-fifths fail; explanation per assignment.
- Pipeline resolves weights None -> ScoreWeights(); missing group label raises KeyError (documented).

## Fix note
Added autouse fixture removing OPENAI_API_KEY for non-llm tests plus a test proving it; README Hungarian paragraph de-hardcoded and stale next-step removed.

N1,N2 (stale ids ValueError + test), N4 (stdout errors=replace), N5 (OPENAI_MODEL in README), N6 (explain cache + test), N7 (llm timeout=15, max_retries=0) applied. 118 passed; dummy-key run 15.8s.
