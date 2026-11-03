# Task 7 report: Hungarian and Gale-Shapley allocation

Status: DONE (no commit, per instructions)

Files: fairmatch/core/allocation.py, fairmatch/tests/test_allocation.py

- TDD: tests written first and failed (ModuleNotFoundError), then implemented.
- Result: 14 passed; ruff clean.
- Hungarian: seats expanded per posting capacity, rectangular linear_sum_assignment(maximize=True). A 1e-12 index-based bonus breaks ties toward lower candidate/posting indices.
- Gale-Shapley: candidate-proposing deferred acceptance; ties by lower posting index when proposing, and lower candidate index kept on eviction.
- Empty inputs and zero capacities return no assignments with all candidates unallocated. Negative capacity is treated as 0.
- Hungarian verified against brute force (including capacity 2+1 cases over 10 seeds).

Concerns: scores shape mismatch raises ValueError. The tie-break bonus could in theory change the optimum for score gaps below about 1e-9.

## Fix note (judge-wave-1 B2, notes 1-2)
- Replaced fixed 1e-12 tie bonus with one scaled so its total is below 1e-7; regression test at 1100x1100.
- Documented tie rule (not lexicographic); added partial-tie exact-output test.
- _prepare now rejects NaN/inf with ValueError for both algorithms (tests added).
