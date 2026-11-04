# M3 Task 6 report: runs, results, explanations

Status: implemented; all new tests pass. One pre-existing shared test fails (see concerns).

Files: src/pages/{Runs,RunDetail}.tsx, src/components/{StartRunForm,AllocationTable,ExplanationPanel,RunStatus}.tsx, src/lib/{format,runs}.ts, tests beside each, src/pages/__fixtures__/real-{run,explanations}.json (real backend payloads).

Commands: typecheck, lint and build pass. npm test x3: 365 passed, 1 failed each run (same test, deterministic, not flaky).

Concerns
1. src/App.test.tsx `test_admin_route_/runs/3` still expects the stub heading "RunDetail" (and has no /api/runs/3 handler). It must be updated by its owner (expect "Run #3" and add a handler, or drop the case).
2. Server lists runs oldest-first (order_by id), so "newest first" is only applied within each page (id desc). True newest-first needs `order_by(id.desc())` in fairmatch/api/routers/runs.py.
3. Comparison tab is always present for done runs (single-algorithm summary) per ruling 5, contradicting the plan test line "hidden for single-algorithm runs".
4. Explanation missing for an allocation: falls back to the allocation's own reasons/narrative with a visible note.
5. Fake-timer tests restrict toFake to timers+Date so MSW still works.

## Fix round (judge follow-up)
- m12 killed: AllocationTable tests for per-algorithm seat counts (same candidate/1 seat -> 1 / 1; different candidates/2 seats -> 1 / 2).
- m04a killed: StartRunForm test with two same-tick form submits sends one request (only the ref guard passes it).
- Runs.tsx comment updated; sort kept as defence. Stuck note now role="status" (tested). index.html got `<link rel="icon" href="data:," />`.
- Skipped notes: focus management on navigation, explanation panel heading/scroll, name-list staleTime (design changes beyond a small fix; ExplanationPanel/RunDetail left as judged PASS).
