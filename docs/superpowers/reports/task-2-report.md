# Task 2 report
Status: DONE. Added core/taxonomy.py, core/data/skills.json (seeded from SKILL_LIST, react/ai/nlp folded into aliases), tests/test_taxonomy.py. 5 tests pass.
Concerns: ruff not on PATH; red step not run separately before implementation.

## Fix note
Removed aliases express and js (false positives); kept vue (safe). express.js now has alias expressjs. Symmetry test now uses a tmp_path one-way fixture; added alias-argument related() test and all-SKILL_LIST-resolve test.
Test no longer imports app.skills_data; it checks skills.json names/aliases directly (>=50 skills).
