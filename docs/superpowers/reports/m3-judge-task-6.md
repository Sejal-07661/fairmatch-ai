# M3 Task 6 judge report (runs, results, comparison, fairness, explanations)

VERDICT: PASS (0 blocking issues; 8 non-blocking notes, listed in the Summary at the end)

## Check 1: suite, static checks, ownership, backend

- npm test run 1: 33 files, 366 passed, 0 failed (46 s). stderr shows only the pre-existing ErrorBoundary.test.tsx "kaboom" jsdom stack (committed in HEAD, not Task 6).
- npm test run 2: 366/366 passed. A first run 3 was disrupted by a host suspend (judge session cut off by a usage limit: per-test durations of 1 380 000 to 2 665 000 ms across unrelated files, i.e. wall-clock jumps, not a code flake). Rerun 3: 366/366 passed, exit 0. No genuine flake observed.
- typecheck: pass. lint: pass (0 problems). build: pass (only the >500 kB chunk advisory, pre-existing).
- `git diff HEAD --stat` on package.json, package-lock.json, src/api, src/auth, src/test, src/components/charts, DataTable.tsx, Pagination.tsx, App.tsx, vite.config.ts: empty (unchanged). Changed tracked files: App.test.tsx, pages/Runs.tsx, pages/RunDetail.tsx (stub replacements), fairmatch/api/routers/runs.py (1 line), fairmatch/tests/api/test_runs.py (+12), two report notes. Untracked: exactly the Task 6 ownership list plus __fixtures__/real-{run,explanations}.json and the Task 6 report.
- grep for dangerouslySetInnerHTML / localStorage / @ts-ignore / @ts-expect-error / .skip( / .only( / `any` / eslint-disable over all Task 6 source and test files: no hits.
- Backend: `pytest tests/api/test_runs.py tests/api/test_openapi_snapshot.py -q`: 25 passed. `python scripts/export_openapi.py --check`: "openapi.json is up to date".
- Note (non-blocking): src/pages/Runs.tsx:53 comment "The API pages oldest-first" is now stale after the backend change (the client-side per-page sort is harmless).

Check 1: PASS.

## Check 2: interfaces vs plan Task 6

Read Runs.tsx, RunDetail.tsx, StartRunForm.tsx, RunStatus.tsx, AllocationTable.tsx, ExplanationPanel.tsx, lib/runs.ts, lib/format.ts against the plan.

- StartRunForm: radios both (default, StartRunForm.tsx:14) / hungarian / gale_shapley, labelled inside a fieldset+legend; `useStartRun` -> navigate(`/runs/${id}`) (:28-29); error `detail` (ApiError.message) in an aria-live=polite status region (:63-65); one request on double submit via an `inFlight` ref guard plus disabled button (:23-24, :58). Tests cover 422 x2, 503, double click + Enter spam. Matches.
- RunStatus({ run, waitingSince, onRefresh?, refreshing? }): icon (svg, aria-hidden) + text label per status incl. unknown (RunStatus.tsx:47-61); elapsed "Waiting Ns" ticking every 1 s while pending/running (:66-74, :81); Refresh button (:82-91); polite live region "Run N status: X" (:93); stuck note after 60 s (:16, :75, :94-96); failed shows `error` text or a generic message as role=alert (:97-101). Matches.
- RunDetail: real role=tablist (aria-label "Run results") / role=tab (aria-selected, roving tabIndex) / role=tabpanel (aria-labelledby) with ArrowLeft/ArrowRight wrap, Home, End, focus moves with selection (RunDetail.tsx:24-73). Only the active panel is mounted, so aria-controls is set only on the selected tab (acceptable). Results=AllocationTable, Comparison=ComparisonCharts or single-algorithm summary (ruling accepted), Fairness=FairnessCharts with `metrics.fairness_skipped` as reason, Explanations=ExplanationPanel. Malformed metrics -> inline alert above the tabs, tabs still render (:172-176). 404 / invalid id -> "Run not found" (:125-127).
- AllocationTable: rows ordered by opportunity id then score desc, "Seats used / capacity" per selected algorithm, names via useAllCandidates/useAllOpportunities with "Candidate #id"/"Opportunity #id" fallback (lib/runs.ts:43-45), score toFixed(3), algorithm radio switch only when >1 algorithm, Unallocated list from metrics[algo].unallocated (capped at 50 + "and N more"), truncated/failed banners, pagination at 25 via DataTable. Matches (grouping is by sort order + per-row seats column, not separate group headers: acceptable).
- ExplanationPanel: `useExplanations(runId)` indexed by `allocKey(algorithm, candidate_id)` = `${algorithm}:${candidate_id}` (lib/runs.ts:5, ExplanationPanel.tsx:56-67); Explain button per allocation; Detail shows reasons list, narrative (clamped at 280 with "Show full text", full text in title), "Template explanation (no AI model used)" when used_fallback, BreakdownBar from the allocation's breakdown, inline error if the breakdown fails zod. Missing explanation falls back to the allocation's own text with a visible note.
- Runs list: columns Run (link), Algorithm, Status badge, Created, Finished (Runs.tsx:26-48); server paging {limit:25, offset:(page-1)*25} (:52), plus a per-page id-desc sort; Pagination shown when page>1 or a full page; no polling on the list. Matches.

Mismatches (non-blocking):
- src/pages/Runs.tsx:53 stale comment (API is now newest-first).
- src/components/RunStatus.tsx:94-96 the stuck note is not inside a live region, so it appears silently (the status itself is announced). Minor.

Check 2: PASS (no interface mismatches beyond the accepted Comparison ruling).

## Check 3: real end-to-end (real backend + real frontend + Chromium)

Setup: backend `python -m uvicorn api.main:create_app --factory --port 8765` (timeout 600) with JWT_SECRET=judge-secret, DATABASE_URL=sqlite:///<scratchpad>/judge6/judge-m3.db, CELERY_EAGER=true, REDIS_URL=fakeredis://, HF_HUB_OFFLINE=1, OPENAI_API_KEY unset; `python -m alembic upgrade head`; `python -m api.cli create-admin admin@example.com ...`. Frontend: vite 8 dev from a scratch copy (judge6/fe, node_modules junction, proxy target 8765 changed only in the copy) on 5199 with a hard `timeout 120` per browser session. Chromium: %LOCALAPPDATA%/ms-playwright/chromium-1248/chrome-win64/chrome.exe via executablePath (headless).
Seed via API: 3 candidates (Priya ML: python/pytorch/ML; Rahul Frontend: react/js/ts; Meera Data: sql/tableau), demographics GroupA/GroupB/GroupA, 3 opportunities (ML Engineer cap 1, Frontend Developer cap 2, Data Analyst cap 1).

Session A (UI sign-in as admin, start 'both' from the Runs page):
- Sign-in lands on /runs; "Both (compare)" checked by default; one click on Start run -> exactly 1 POST /api/runs -> navigated to /runs/1; status seen: done (eager mode finishes inside the POST).
- Results: Hungarian/Gale-Shapley switch; rows ML Engineer 1 / 1 Priya ML 0.950; Frontend Developer 1 / 2 Rahul Frontend 0.927; Data Analyst 1 / 1 Meera Data 0.930; names resolved; "Unallocated: Every candidate was allocated." (3 candidates, 4 seats; API unallocated [] for both).
- Comparison: three small multiples; total score 2.81/2.81 (API 2.807368), blocking pairs 0/0 shown as a visible zero stub with "0" labels, runtime 0.24/0.07 ms (API 0.2423/0.0749); table toggles show the same numbers.
- Fairness: GroupA/GroupB 100.0% each; ratio "1.000" (3 decimals) for both algorithms, badge "Passes four-fifths rule" with icon; API passes_four_fifths=true, ratio 1.0, parity 0.0. Matches.
- Explanations: 6 Explain buttons (aria-label "Explain Priya ML (Hungarian)" ...); detail shows "Template explanation (no AI model used)", 4 reasons, narrative, breakdown bar 0.35+0.40+0.10+0.10 = 0.95 = total 0.95 (table view: Semantic 0.88x0.4, Skills 1.00x0.4, Experience 1.00x0.1, Education 1.00x0.1), matched-skill chips.
- 360 px: documentElement.scrollWidth == clientWidth == 360 on Results, Comparison, Fairness, Explanations and /runs (no page overflow); wide tables scroll inside their own overflow-x container. Screenshots inspected: no collisions, overflow or unreadable text; tabs wrap to two rows at 360 px (fine).
- Timestamps: API created_at "2026-11-04T14:58:32.997050" (naive UTC); UI shows "Nov 4, 2026, 8:28:32 PM"; browser clock at that moment 20:28:51 IST = 14:58:51Z. So naive values are treated as UTC and displayed in local time (+05:30), consistent with the wall clock: no off-by-5.5h, no "Invalid Date". The `title` shows the raw naive string.
- Console: one "Failed to load resource: 404" (backend log has zero 4xx/5xx, so it is the dev server; see session B for the URL). No page errors. ERR_ABORTED duplicates are React StrictMode double-mount aborts in dev (each query issued twice, first aborted), not a defect.
- Observation (non-blocking): useAllCandidates/useAllOpportunities refetch on every tab switch (staleTime 0, each tab remounts its panel): 2 extra list requests per switch. Harmless at this scale.

Session B (4th candidate "Arjun Ops" created via API WITHOUT demographics; Gale-Shapley selected in the UI; Start run double-clicked):
- Exactly 1 POST /api/runs (double click), algorithm Gale-Shapley honoured (run #2 header "Gale-Shapley"); Results has no algorithm switch; Frontend Developer 2 / 2 (Rahul Frontend 0.927, Arjun Ops 0.440).
- Comparison: "Only Gale-Shapley ran, so there is nothing to compare." + summary (total 3.25, blocking 0, runtime 0.11, unallocated 0) (accepted ruling).
- Fairness: "Fairness was not computed for this run." + exact reason "demographics missing for 1 of 4 candidates". PASS.
- Keyboard on the live tablist: from Fairness ArrowRight -> Explanations, ArrowRight -> Results (wraps), Home -> Results, End -> Explanations, ArrowLeft -> Fairness; focus and aria-selected follow; tabpanel aria-labelledby=tab-fairness.
- Console: the same single 404: no page `response` >= 400 was observed, index.html has no favicon link and there is no public/ dir, so it is the browser's /favicon.ico request to the dev server (pre-existing Task 1 scaffold; non-blocking, fix: add `<link rel="icon" href="data:,">` to index.html).

Session C (5th candidate named `<script>alert(1)</script><img src=x onerror=alert(2)> مرحبا بالعالم 😀🎉 W*150` with hostile resume text, no demographics; 28 hungarian runs + 1 'both' run via API, 31 runs total):
- Runs list page 1: ids 31..7 (25 rows, strictly descending), "Page 1", Next enabled; page 2: ids 6..1, "Page 2", Next disabled; requests `/api/runs?limit=25&offset=0` then `offset=25`; no overlap, union = 1..31. No "Invalid Date"; Created/Finished e.g. "Nov 4, 2026, 8:32:05 PM" for a run created at 15:02:05Z (correct IST). 360 px: no page overflow.
- Run #31 Results: hostile name rendered as literal text, truncated with ellipsis in the cell (full text in title); 0 `img[src=x]` elements, 0 injected scripts, 0 dialogs; Unallocated lists "Arjun Ops" by name. Fairness reason "demographics missing for 2 of 5 candidates". Explanations: hostile row Explain works; 360 px Results/Explanations: no page overflow.
- Group labels: "GroupA"/"GroupB" absent from the HTML of Results, Comparison, Explanations (every Explain detail opened) and the Runs list on run #1; present only on Fairness. PASS.
- Notes (non-blocking): the Explanation detail panel (ExplanationPanel.tsx:148-149) does not say which candidate/opportunity/algorithm it explains, and it renders below a table of up to 25 rows with focus left on the Explain button, so the result can be off-screen; at 360 px the Explain column sits at the far right of the horizontally scrolling table. Suggest a heading like "Explanation: <candidate> -> <opportunity> (<algorithm>)" and scrolling/focusing the panel on selection.

Screenshots (all looked at; no overflow, collision or unreadable text found):
- judge6/shots/a-runs-desktop.png, a-results-desktop.png, a-comparison-desktop.png, a-fairness-desktop.png, a-explanations-desktop.png
- judge6/shots/a-results-360.png, a-comparison-360.png, a-fairness-360.png, a-explanations-360.png, a-runs-360.png
- judge6/shots/b-results-desktop.png, b-comparison-desktop.png, b-fairness-desktop.png
- judge6/shots/c-runs-page1-desktop.png, c-runs-page2-360.png, c-hostile-results-desktop.png, c-hostile-results-360.png, c-hostile-explanations-360.png
(base dir: C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\judge6\shots\)

Check 3: PASS (servers/db cleanup recorded at the end of the report).

## Check 4: stale-result suspicion, pending forever, polling cadence (real browser)

Backend 2 on port 8766: CELERY_EAGER=false, no worker, separate db judge6/judge-m3-pending.db (2 candidates with demographics, 1 opportunity cap 1). Vite copy proxied to 8766.

Session D (first attempt; the host was suspended for ~620 s in the middle, so its cadence numbers are void, the qualitative results stand):
- POST /runs (API) -> run 1 `pending`; /runs/1 shows the Pending badge, live region "Run 1 status: Pending", "Waiting 0s, 5s, 10s, 15s, 20s" ticking each second (sampled), stuck note visible once elapsed > 60 s, page kept polling (status stayed pending, no errors).
- Refresh click: exactly 1 extra GET /api/runs/1 within 400 ms.
- Run then executed out of band (`execute_run` in a separate pre-warmed Python process on the same db): the open page went pending -> done 1.3 s later with NO navigation/reload, live region "Run 1 status: Done", 4 tabs appeared, Results showed "Dev 1 / 1 Pending One 0.678", Unallocated "Pending Two"; 0 GET /api/runs/1 in the 4 s after done (polling stopped). `running` was not observed only because the pre-warmed run finished between two polls; re-tested in session D2.

Session D2 (clean rerun; run 2 created pending via API, page open 60+ s, then status flipped to `running` in the db, then `_do_run` executed out of band):
- Elapsed: "Waiting 0s, 10s, 20s, 30s, 40s, 50s, 1m 01s" (sampled every 10 s, ticks every second).
- Stuck note first visible at 61.4 s after creation ("Waiting 1m 01s"); disappears once done. Screenshot d2-pending-stuck-desktop.png / d2-pending-stuck-360.png: badge with icon + "Pending", waiting text, Refresh, amber note, "Results will appear here when the run finishes."; no overflow at 360 px.
- Polling cadence over a 60 s steady window: 40 GET /api/runs/2, gaps min 1517 / mean 1526 / max 1538 ms; zero overlapping requests in steady state (the only overlap is the StrictMode dev double-mount at first render, whose first request is aborted).
- Refresh: exactly 1 new request within 300 ms.
- Transitions on the open page WITHOUT reload (0 navigations): pending -> running 1.3 s after the db change (next poll; live region "Run 2 status: Running", elapsed keeps ticking "Waiting 1m 10s") -> done (live region "Run 2 status: Done", tabs + Results "Dev 1 / 1 Pending One 0.678", Unallocated "Pending Two"). 0 run requests in the 4 s after done (polling stops).
- Verdict on the Task 2 "stale result.current" observation: not reproducible in a real browser; the UI never failed to update. It is a fake-timer/renderHook test artefact, not a product defect. Not blocking.

Check 4: PASS.

## Check 5: privacy and role

- Existing test RunDetail.test.tsx:387-399 (`test_candidate_role_gets_forbidden_with_zero_requests`) renders the real `<App/>` route table at /runs and /runs/5 with a candidate token, asserts the Forbidden heading and an empty MSW `request:start` list. Passes in all 3 suite runs.
- Live (session E, real backend): signed in through the UI as candidate ml@example.com (lands on /profile), then opened /runs, /runs/1, /runs/31 directly: each redirected to /forbidden with heading "Forbidden"; ZERO /api requests were issued after the profile page settled.
- Group labels: absent from Results, Comparison, Explanations (all details opened) and the Runs list; present only in the Fairness tab (session C). The admin-only Fairness tab is the only consumer of `run.fairness`.
- Resume text: never rendered. CandidateOut has no resume_text; on run #31 (all 4 tabs, every Explain opened) the DOM contains none of "lorem ipsum", "alert('r')", or any seeded resume sentence (session E).
- Hostile strings live (session C): a candidate named `<script>alert(1)</script><img src=x onerror=alert(2)> مرحبا بالعالم 😀🎉 W*150` renders as text in Results, Unallocated, the Explanations table and Explain aria-label; 0 injected img/script elements, 0 dialogs, no page overflow at 360 px. The API caps names at 255, so 5000-char names/skills/narratives/reasons were tested with a throwaway unit test (Check 6 file): all render as text (0 img/script in the container, literal "<script>alert(1)</script>" in textContent), long reasons/narrative clamp at 280 with "Show full text", table cells truncate with the full text in title.

Check 5: PASS.

## Check 6: malformed data (throwaway tests in frontend/src/__judge_tmp__/judge6.test.tsx, deleted afterwards)

23/23 throwaway tests passed (console.error/warn guard active, so no React error or warning either):
- RunDetail via the real App route, done run with metrics missing `unallocated`: "Run metrics could not be read" alert, Results still lists allocations with "The unallocated list is unavailable...", Comparison "Comparison is unavailable...", Fairness renders, Explanations has Explain buttons.
- metrics null + fairness null on a done run: heading + tabs render, Fairness and Comparison panels non-empty.
- fairness = "garbage", allocations = null: "No allocations in this run.", Fairness tab shows an inline role=alert; status "exploded": "This run has an unrecognised status..." (never blank).
- unknown ids: "Candidate #999", "Opportunity #888", seats "1 / ?", unallocated id 12345 -> "Candidate #12345".
- explanations [] / duplicated (first wins) / `{not: "an array"}` / `[null, 42, "x", {algorithm: 3}]`: never throws; falls back to the allocation's own text with the note; duplicate shows the first record.
- breakdown missing keys: "Score breakdown unavailable: ..." inline, reasons/narrative still shown.
- 5000-char hostile strings in candidate name, opportunity title, reasons, narrative, matched/related skills: text only, 0 img/script, "Show full text" present.
- 5000 allocations: first page rendered in 74 ms (jsdom) with "Page 1 of 200" and 25 data rows (< 2 s).
- Timestamp helper (parseApiDate/formatTimestamp, en-IN locale in the test env): naive "2026-11-04T14:58:32.997050" -> 14:58:32.997Z -> "4 Nov 2026, 8:28:32 pm"; Z, lowercase z, +05:30, +0530, space separator all -> the same instant; no seconds OK; date-only -> 00:00Z (5:30 am local; the API never sends date-only); "9999-12-31T23:59:59" -> "1 Jan 10000, 5:29:59 am"; "0001-01-01T00:00:00" -> "1 Jan 1, 5:53:28 am" (historic LMT offset from Intl, not a bug); epoch number, "", garbage, "2026-13-45T99:99:99", null -> "unknown". Never "Invalid Date"/NaN.
- Note (non-blocking): an epoch number shows "unknown" rather than a date; the contract is string-only, so acceptable.

Check 6: PASS.

## Check 8: accessibility and regressions

- Tabs (live + test): role=tablist with aria-label, role=tab with aria-selected and roving tabIndex (only the selected tab is in the Tab order), ArrowLeft/Right wrap, Home/End, focus follows selection, tabpanel aria-labelledby the selected tab. Selected state = underline + weight + aria-selected (not colour alone).
- Focus after navigation to /runs/:id (live): document.activeElement is BODY after Start run navigates (the clicked button unmounts) and after a direct load. Layout has a skip link and `<main id="main" tabIndex={-1}>`, but nothing moves focus to the new page. Non-blocking (not a plan requirement); suggested fix: `tabIndex={-1}` on the RunDetail h1 and focus it on first render of a run (RunDetail.tsx:149).
- Labels: algorithm radios in fieldset+legend (StartRunForm.tsx:41-55); Results algorithm radios in a labelled radiogroup (AllocationTable.tsx:79-87); Explain buttons have aria-label "Explain <candidate> (<algorithm>)" (ExplanationPanel.tsx:108); Refresh/Retry/Show full text buttons have visible text; run links "Run N".
- aria-live: status region "Run N status: Pending/Running/Done" updated live (verified in D2); StartRunForm errors in a polite status region; Pagination page label polite. The stuck note itself is not in a live region (non-blocking, see Check 2).
- Colour never the only signal: run status badges = svg icon + text label (Pending/Running/Done/Failed/Unknown); fairness pass/fail badge = icon + text; failed run error text in role=alert.
- Headings: /runs h1 "Runs" > h2 "Start a run", h2 "All runs"; /runs/:id h1 "Run #N" > h2 <tab name> > h3 (chart frames, "Unallocated", "Explanation") > h4 (fairness per-algorithm, matched skills). No skipped levels.
- Regressions: full suite 366/366 x3 (Check 1), including every earlier test file; App.test.tsx updated only to replace the stub-era /runs/3 case. Console noise during tests: none from Task 6 (the setup guard throws on console.error/warn); the only stderr is the pre-existing ErrorBoundary "kaboom" jsdom stack from a committed test.
- Files: git status lists exactly the Task 6 ownership set (+ __fixtures__ JSON, the Task 6 report, two report follow-up notes, the 1-line backend change and its test) plus this verdict file; nothing else created in the repo (throwaway src/__judge_tmp__ deleted). Vite's dependency pre-bundle cache under the gitignored node_modules/.vite was refreshed by the scratch dev server (via the junction), as in earlier judge runs.

Check 8: PASS (non-blocking focus-management note).

## Check 7: test quality (mutation testing in the scratch copy judge6/fe, node_modules junction; repo untouched)

Baseline in the copy: the 7 Task 6 test files, 73/73 pass. 23 mutants, each run against the relevant test files; 21 KILLED, 2 SURVIVED.

| Mutant | Result | Killed by |
|---|---|---|
| m01 RunDetail 404 check removed (status check before generic error panel) | KILLED | test_404_after_pending_stops_polling |
| m02 naive timestamp not suffixed with Z (not UTC) | KILLED | format.test "treats a naive ISO string as UTC", test_stuck_note_and_waiting_time_for_old_pending_run |
| m03 join key `${candidateId}` (drops algorithm) | KILLED | test_join_is_by_algorithm_and_candidate |
| m04a StartRunForm inFlight ref guard removed | SURVIVED | (disabled button still blocks; see below) |
| m04b ref guard AND `disabled={busy}` removed | KILLED | test_double_click_and_enter_spam_send_one_request, test_button_disabled_while_pending |
| m05 unknown candidate id fallback -> "" | KILLED | test_unknown_ids_fall_back..., RunDetail id fallback |
| m05b unknown opportunity id fallback -> "" | KILLED | test_unknown_ids_fall_back... |
| m06 truncated banner removed | KILLED | test_truncated_banner_when_lists_hit_cap |
| m07a ArrowRight does not advance | KILLED | test_tabs_have_roles_and_arrow_key_navigation |
| m07b arrow keys do not move focus | KILLED | same |
| m07c Home/End removed | KILLED | same |
| m08a stuck threshold doubled (120 s) | KILLED | test_waiting_time_increments_and_stuck_note_after_60s |
| m08b stuck note shown immediately | KILLED | same |
| m09 per-algorithm filter removed | KILLED | test_algorithm_switch_only_when_both_present (+2) |
| m10 Runs client sort removed | KILLED | test_lists_runs_newest_first_with_labels_and_badges |
| m11 used_fallback notice never shown | KILLED | 2 tests |
| m12 seats used counted across BOTH algorithms | SURVIVED | none |
| m13 waitingSince = Date.now() instead of created_at | KILLED | test_stuck_note_and_waiting_time_for_old_pending_run |
| m14 status live region removed | KILLED | RunStatus icon+text tests |
| m15 fairness_skipped reason not passed | KILLED | test_fairness_tab_shows_skipped_reason |
| m16 score toFixed(2) | KILLED | test_groups_with_capacity_names_and_three_decimals |
| m17 Runs offset ignores page | KILLED | test_paginates_with_limit_and_offset |
| m18 failed-run error text hidden | KILLED | 2 tests |

Survivors (non-blocking test gaps):
- m04a: equivalent in practice. React 18 flushes the `busy` state synchronously after a discrete click/keydown, so the disabled button already blocks the second event; the ref is defence in depth. Optional: a test that dispatches two `submit` events on the form element in the same tick.
- m12 (AllocationTable.tsx:44-46): no test has a 'both' run where the per-algorithm seat count differs from the all-algorithm count, so counting `allocs` instead of `mine` would show e.g. "2 / 2" for an opportunity holding one seat per algorithm. The code is correct today (live run #1 shows "1 / 2"). Suggested test: allocations hungarian(c1->o1) + gale_shapley(c2->o1), capacity 2 -> expect "1 / 2" under each algorithm.

Check 7: PASS (21/23 killed; the 2 survivors are a defensive duplicate and one missing assertion, not product defects).

## Summary

VERDICT: PASS

Blocking issues: none (0).

Non-blocking notes (optional fixes):
1. src/pages/Runs.tsx:53: the comment "The API pages oldest-first" is stale after the GET /runs id-desc change. Fix: reword it, e.g. "API returns newest first; keep a stable id-desc order within the page".
2. src/pages/RunDetail.tsx:149: focus is left on BODY after Start run navigates to /runs/:id. Fix: `tabIndex={-1}` on the h1 and focus it once per run id.
3. src/components/ExplanationPanel.tsx:148-149: the detail panel does not say which match it explains and can render off-screen below 25 rows. Fix: heading "Explanation: <candidate> -> <opportunity> (<algorithm>)" and scroll/focus the panel on selection.
4. src/components/RunStatus.tsx:94-96: the 60 s stuck note is not in a live region. Fix: role="status" on the note (or append it to the existing polite region).
5. Test gap (mutant m12 survived), src/components/AllocationTable.tsx:44-46: add a 'both' fixture where per-algorithm seat counts differ from the combined count.
6. Mutant m04a (StartRunForm inFlight ref) survives only because the disabled button already blocks the second event; optional same-tick double-`submit` test.
7. index.html (Task 1 scaffold, not Task 6): no favicon link, so the dev browser logs one "Failed to load resource: 404" per page load. Fix: `<link rel="icon" href="data:,">`.
8. useAllCandidates/useAllOpportunities refetch on every tab switch (staleTime 0, panels remount). Harmless at this scale; optionally set a staleTime for name lookups.

Environment notes: the host was suspended twice during the judge (a disrupted first test run 3, and the first pending-run browser session). Both were rerun cleanly, and only the clean measurements are used above. The earlier per-test durations of 1 380 000+ ms were wall-clock jumps, not flakes.

Screenshots (base C:\Users\Sejal\AppData\Local\Temp\claude\e6e6c0298dfbc173\7c8369ad-8765-4135-a3c3-df4a38fc5988\scratchpad\judge6\shots\):
a-runs-desktop.png, a-results-desktop.png, a-comparison-desktop.png, a-fairness-desktop.png, a-explanations-desktop.png, a-results-360.png, a-comparison-360.png, a-fairness-360.png, a-explanations-360.png, a-runs-360.png, b-results-desktop.png, b-comparison-desktop.png, b-fairness-desktop.png, c-runs-page1-desktop.png, c-runs-page2-360.png, c-hostile-results-desktop.png, c-hostile-results-360.png, c-hostile-explanations-360.png, d-pending-stuck-desktop.png, d-after-exec-done-desktop.png, d2-pending-stuck-desktop.png, d2-pending-stuck-360.png, d2-running-desktop.png, e-candidate-forbidden-desktop.png.

Cleanup: backends on 8765/8766 and every vite on 5199 stopped (orphaned uvicorn python processes killed by PID); ports 5199/8765/8766 confirmed not listening; port 8000 never touched; both db files (judge-m3.db, judge-m3-pending.db) deleted; scratch copy junction removed with `cmd /c rmdir`, then the copy deleted (repo node_modules intact, 259 entries); no leftover chrome/vite/uvicorn processes; throwaway frontend/src/__judge_tmp__/ deleted. `git status` and `git diff HEAD --stat` (7 files, +307/-5) are identical to the start, plus this verdict file. A pre-existing scratch dir from an earlier agent (scratchpad/fe, with its own junction) was left as found, except that its src/ and vite.config.ts were overwritten by an initial copy attempt.
