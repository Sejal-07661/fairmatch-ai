# Task 9 report: Fairness audit
Status: DONE. Files: core/fairness.py, tests/test_fairness.py.
Tests: 7 passed (red confirmed first via collection error; includes fairlearn parity check and empty-input case).
Notes: KeyError raised for any assignment or unallocated id missing from group_of. ruff not on PATH; see run result in handoff.

Fix note: ratio now computed from exact Fractions (fixes 0.8 boundary); added boundary, mean_score, unallocated-KeyError tests. 10 passed.
