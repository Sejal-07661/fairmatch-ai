# M2 Task 5 report

Implemented candidates/opportunities endpoints, services/profiles.py, embed_profile task, schemas. TDD: 38 new tests failed first (404s), then pass. Candidate role on /candidates/{id} gets 403. Commit-before-delay in both POSTs; 409 via pre-check plus IntegrityError rollback.

## Fix note (judge B1-B3)
- B1: parse errors are recorded inside the except, raised after the `with TemporaryDirectory(prefix="fairmatch-upload-")` exits; ignore_cleanup_errors dropped. Test checks no fairmatch-upload-* dirs remain. Removed leftover judge-listed tmp dirs (matching resume.pdf payload, plus tmpmjcbzyg5/tmpsmgez75u if present).
- B2: NUL rejected (422) in name, resume_text, uploaded content, title, posting_text, group_label.
- B3: capacity <= 10000, experience <= 80 and finite, ids/offset <= 2147483647 via shared types in schemas.py; RequestValidationError handler in main.py returns {"detail": str} without echoing input values.
- Notes: enqueue failure after commit is logged and still returns 201; oversize test uses 5 MiB+1 pdf/docx bodies.
- Open: disk use before the size check is unbounded per request (Starlette spools multipart); needs a reverse-proxy body limit in Milestone 4.
