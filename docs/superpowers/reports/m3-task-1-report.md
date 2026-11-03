# M3 Task 1 report

Done: openapi export script + snapshot (3 pytest tests, red then green, mutation of openapi.json makes 2 fail), frontend scaffold (Vite 8, React 18, TS 5.9 strict, Tailwind v4, Vitest 5, MSW 2.15), .gitignore/.gitattributes updated.
Verified: snapshot tests, test_app.py, ruff, npm test/typecheck/lint/build all pass; lint rejects dangerouslySetInnerHTML.
Notes: typescript pinned ~5.9 (openapi-typescript peers ^5; typescript-eslint <6.1). msw pinned ^2. npm audit reports 13 moderate vulns (dev tooling), not addressed.
