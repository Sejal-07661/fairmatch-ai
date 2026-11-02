# Task 1 report
Files: fairmatch/{requirements.txt,pyproject.toml,core/__init__.py,core/models.py,tests/__init__.py,tests/conftest.py,tests/test_models.py}, .gitignore; git init done, nothing committed.
Commands: pip install -r requirements.txt (all OK); pytest -v -> 1 passed; ruff check . -> All checks passed.
Note: ruff excludes legacy app/ and demo.py (import-sort errors in untouched prototype; both go away in Task 11). TDD red step seen (collection error before models.py).
