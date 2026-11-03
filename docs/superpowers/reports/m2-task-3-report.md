# M2 Task 3: Authentication and roles

Status: done, not committed.

Files: api/security.py, schemas.py, deps.py, routers/__init__.py, routers/auth.py, cli.py, tests/api/test_auth.py; api/main.py (include_router).

Decisions:
- bcrypt used directly; password 8..72 bytes enforced in RegisterIn (422); email stripped, lowercased, non-blank.
- JWT HS256 pinned on decode (HS512 and alg none rejected); sub is str user id.
- DB role is authoritative; token role claim ignored; deleted user gives 401.
- Login verifies against a dummy bcrypt hash for unknown emails; identical 401 body.
- Register commits inside the endpoint, maps IntegrityError to 409 after rollback.
- Annotated[...] Depends style used to satisfy ruff B008 (pyproject untouched).
- CLI imports no settings at import time; main() needs DB settings at run time.

Tests: 19 new pass; full fast suite 172 passed; ruff check clean.
