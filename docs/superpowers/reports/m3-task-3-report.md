# M3 Task 3: Candidate profile page

Files: frontend/src/pages/Profile.tsx, src/components/ResumeForm.tsx, src/lib/validation.ts and tests (Profile.test.tsx 13, validation.test.ts 7, ResumeForm.test.tsx 2).

- Red first: validation and Profile tests failed before implementation.
- Submit guarded by a ref; it stays locked after success (form is replaced by the refetched profile) and unlocks only on non-409 errors.
- Admins render a notice + link and never call useMyCandidate (separate component).
- Pending state is a text/aria-live status (fetch has no upload progress events).
- Test note: the jsdom File loses its filename through undici FormData in the test server, so the file test asserts size; the code appends with file.name.
- Whole-suite status at report time: remaining failures/type/lint errors are only in files owned by the parallel agents (charts, DemographicsEditor, SimilarCandidates, admin pages) and App.test admin-route cases that now hit their unmocked pages. My files pass tests, tsc and eslint.
