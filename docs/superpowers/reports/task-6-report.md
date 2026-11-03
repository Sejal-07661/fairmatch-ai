# Task 6 report

Implemented core/scoring.py and tests/test_scoring.py. 7 tests pass, ruff clean. Red phase seen (collection error, module missing). weights param defaults to None (resolved to ScoreWeights()) to satisfy ruff B008. Empty inputs return (n_c, n_p) zeros; related pair reports alphabetically first related candidate skill.
Fix: ScoreWeights now raises ValueError for NaN/inf weights; tests added.
