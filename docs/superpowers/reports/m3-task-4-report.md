# M3 Task 4 report: admin opportunities and candidates

Status: implemented with TDD (red first, then green).

Added: DataTable, Pagination, OpportunityForm, DemographicsEditor, SimilarCandidates, the four admin pages, src/lib/{education,errors}.ts, and tests (including a candidate-role test asserting zero API requests through the real routes).

Notes:
- Opportunities/Candidates pages page the API 25 at a time (limit/offset, Pagination with hasNext).
- src/App.test.tsx still has two stub-era cases (/opportunities/3, /candidates/3) that expect a synchronous stub heading; they now fail and need updating by the owner of App.test.tsx.
- npm run build and typecheck currently fail only on in-progress src/components/charts/* files owned by another agent.
- hooks.test.tsx retry-policy tests failed once under full-suite load and passed in isolation (timing flake).
