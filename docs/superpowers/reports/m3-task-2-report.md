# M3 Task 2 report

Implemented the typed client, zod contracts, token/auth handling, role routing, hooks, layout, error boundary, login/register pages, and stub pages for later tasks.

Notes:
- parseRunMetrics(null) is an error result (a pending run has null metrics); consumers should check run status first. useRun exposes `parsed: {metrics, fairness}`.
- 401 dedupe: handler fires once per burst; the burst ends when no apiFetch calls are in flight.
- Hooks use `shouldRetry` (network/5xx only, max 2); tests' QueryClient is overridden per query by this.
- Stub pages (Profile, Opportunities, OpportunityDetail, Candidates, CandidateDetail, Runs, RunDetail) render only an h1; Layout supplies `<main id="main">`.
- Test helper src/test/render.tsx added (makeToken, renderApp).

## Fix note (judge blockers B1-B3 and notes)

- B1: App.tsx now wraps Routes in AuthProvider (inside ErrorBoundary); renderApp no longer adds a provider (tests that render pages directly wrap AuthProvider in the test file). New test renders BrowserRouter + QueryClientProvider + App as main.tsx does and asserts `Sign in` with no fallback.
- B2: /profile uses role="any"; tests for admin reaching it and signed-out redirect.
- B3: safeNext validates the normalised output (no leading `//` or `/\`, no backslash/control chars, same origin) and returns null otherwise; auth/redirect.test.ts plus Login cases cover the six judge inputs and variants.
- N-a: `apiFetch<T>(path, init?: RequestInit & { json?, parse?: (json: unknown) => T })`.
- N-b: session generation (`bumpSession` on login/logout/401); stale 401s are ignored; tested.
- N-c: candidate ids are numeric in keys; useSetDemographics invalidation now hits; tested (also useCreateCandidate).
- N-d: useAllCandidates/useAllOpportunities return `truncated`; tested with an endless server (500 pages).
- N-e: tests for running->404 stop, query 5xx = 3 requests, 4xx = 1, mutation 5xx = 1, shouldRetry table, programmatic double submit (kills the busy-ref mutant).
- Skipped: N-11 (backend timestamp timezone, belongs to Task 6) and N-12 (jsdom "kaboom" stderr noise, harmless); other minor notes not affecting later tasks.
