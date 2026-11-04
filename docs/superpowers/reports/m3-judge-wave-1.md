# M3 Judge, Wave 1 (Tasks 3, 4, 5 + Task 2 test cleanup)

Judge: read-only review of the uncommitted working tree on top of HEAD 77cf315.
Status: COMPLETE.

## VERDICT: PASS_WITH_FIXES (3 blocking issues, all in Task 5 charts; Tasks 3 and 4 and the Task 2 test cleanup have no blockers)

Gates are green and stable: 277/277 tests x3, plus 2 concurrent full runs and 10 hooks-file runs with no flake. Typecheck, lint and build pass. package files are unchanged. The backend snapshot test passes. Privacy and role rules hold: a candidate makes zero requests on admin routes, and an admin on /profile makes zero requests. Hostile text renders safely.

### Blocking issues (fix before the wave commit)

**B1. BreakdownBar segment value text fails contrast.** At theme.ts:62-67 (rendered in BreakdownBar.tsx:155-166), the Semantic value label is 12px semibold white on aqua: 2.82:1 in light mode and 3.41:1 in dark, against 4.5:1 required. This label is printed on most real allocations: real payload 0.416 x 0.4 = 0.17, which is above the 0.15 threshold. White on magenta (Experience) also fails at 2.69 / 3.94. It does not show with default weights, but it would show with custom weights.
*Fix:* set `SEGMENT_TEXT.semantic` and `SEGMENT_TEXT.experience` to `#0b0b0b`, which gives 6.99 / 5.78 and 7.31 / 4.99. Keep white on green (4.95) and near-black on yellow (9.09 / 6.41). Add a unit test that computes the WCAG ratio of every `SEGMENT_TEXT` x `BREAKDOWN_PALETTE[mode]` pair and asserts >= 4.5 in both modes.

**B2. The disparate-impact number can contradict its badge.** FairnessCharts.tsx:266 (also :273 aria-label and :340 table) shows `ratio.toFixed(2)`. A realistic 16-candidate run (group A: 4 of 5 selected; group B: 7 of 11) has a ratio of 35/44 = 0.7955. It renders "0.80" next to "Fails four-fifths rule", under a caption that says "0.8 or above passes". The server is right that it fails, but the figure an auditor reads says it passes.
*Fix:*
- Display enough precision to be honest: 3 decimals, or floor to 2 decimals (`Math.floor(r * 100) / 100` gives "0.79").
- Derive pass/fail from `data.passes_four_fifths` at :242 and :342. The server computes it from exact fractions, and zod already requires the field.
- Add tests for 35/44 (the number must not read 0.80 and the badge says Fails) and for an inconsistent payload where the flag wins.

**B3. Zero-valued comparison bars are invisible and unlabelled.** At ComparisonCharts.tsx:105-116, Recharts draws no rectangle and no LabelList text for a value of 0. I checked this in Chromium and jsdom. Gale-Shapley always has 0 blocking pairs, and the real payloads have 0 for both algorithms. So the "Blocking pairs" chart, the headline stability comparison, shows either an empty slot or an empty plot with no numbers. This breaks the plan's "direct value labels". The existing tests deliberately avoid zeros (ComparisonCharts.test.tsx:30-34), and the Task 5 report's claim that "value label still shown" is wrong.
*Fix:* give the Bar a `minPointSize` (for example 2) or a custom `label` renderer that also draws for 0, so every algorithm prints its value. Add a test with `blocking_pairs: 0` for both algorithms that asserts two "0" value labels.

### Non-blocking notes (priority order)
1. **Tests for Task 6 (polling):** mutants survive for the poll interval (1000 and 1750 ms both pass) and for "pending not polled". An overlap mutant is caught only by a 60 s timeout. Task 6 should pin the 1500 ms interval and test a `pending` -> `running` -> `done` run (see 1c).
2. **Interface deviations Task 6 must code against:**
   - `ChartFrame` requires an extra `summary` prop and takes `legend`.
   - `ALGORITHM_COLORS`/`INK` are `var()` strings, not hex.
   - Export styles are mixed (default vs named).
   - Hooks take `{limit, offset}`.
   (See section 2.)
3. Use the server's `passes_four_fifths` even though client derivation provably agrees for every payload the server can produce (B2 fix covers it).
4. **Forms:**
   - OpportunityForm success is not announced.
   - ResumeForm's validation reason is neither announced nor tied to the inputs.
   - No form moves focus after an error.
   - DemographicsEditor sends two PUTs on two synchronous submits.
   - Lengths are counted in UTF-16 units where the API counts code points.
   - The name length check runs on the untrimmed value.
   (F-a..F-e)
5. Limit constants are duplicated in OpportunityForm and DemographicsEditor rather than imported from one module. Error-message fallbacks differ slightly between agents. Task 4's loading text is not in a live region and its detail pages have no h1 while loading or on error.
6. Admin lists page on the server (25 rows), so column sort only reorders the current page. DataTable's string sort is not numeric-aware. A clamped page is not written back to state.
7. **Charts:**
   - Muted 12px axis ticks are 3.50:1 in light mode (the skill's token); prefer secondary ink.
   - Breakdown buttons sit inside `role="img"`.
   - The custom-weights tolerance is 0.01, against the plan's 1e-3.
   - Dark tokens follow the OS while the app is light-only.
   - A real group named "Other" would collide with the fold row.
   - The "Blocking pairs" toolbar wraps on desktop.
8. **Overflow:** a 64-char unbroken label overflows the DemographicsEditor "Current:" line at 360px, and the OpportunityForm server error has no `break-words`. Skills use `key={s}` (CandidateDetail.tsx:40, OpportunityDetail.tsx:38), which is safe only because the backend dedupes skills. Experience shows raw floats ("1 years", "2.3333 years").
9. **Hygiene:** `.gitignore` is changed but belongs to no task. Login.test.tsx and Register.test.tsx are stat-dirty only (empty diff). Pagination.tsx and ChartTooltip.tsx have no test file of their own.

Judge artefacts: every throwaway test under `frontend/src/__judge_tmp__/` is deleted and the directory removed. The dev server on 5199 was killed (port free; 8000 not touched). The scratch copy's node_modules junction was removed safely, link only. Apart from this file, the repo is as I found it.

## Check log

### 1a. Gates
- `npx vitest run` x3: 25 files / 277 tests passed each time (0 failures). stderr shows only the expected ErrorBoundary "kaboom" noise.
- `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run build` exit 0 (191 modules; charts and the preview page are not in the production bundle: 0 matches for ChartsPreview/recharts strings in dist JS).
- package.json / package-lock.json: unchanged vs HEAD (`git diff --quiet HEAD` ok).
- Non-test grep for dangerouslySetInnerHTML|localStorage|@ts-ignore|: any|as any|@ts-expect-error|eslint-disable: clean. Only test hit is `token.test.ts:60` asserting localStorage stays empty (fine).
- No `.skip/.only/.todo/xit/fit`. No console.log/debug/TODO/FIXME; only console use is ErrorBoundary.tsx:15 (by design) and the setup guard.

### 1b. Flake hunt
- `npx vitest run src/api/hooks.test.tsx` x10 sequential: 10/10 pass, 20/20 tests each, ~21 s per run.
- Two full suites concurrently (CPU contention): both 25 files / 277 tests pass, exit 0.
- No failure reproduced anywhere (3 normal + 2 concurrent full runs, 10 hooks runs).

### 1c. Mutation testing of the Task 2 test cleanup (scratch copy, `src/api/hooks.test.tsx` + `client.test.ts`)
Copy at scratchpad `fe_w1` (src + configs, node_modules junction); each mutant applied, tests run, source restored (verified by `diff -r` = identical after every batch).

| Mutant | Result |
|---|---|
| M1 POLL_MS 1500 -> 1000 | **SURVIVED** |
| M2 POLL_MS 1500 -> 1750 | **SURVIVED** |
| M3 shouldRetry max 2 -> 3 retries | killed (test_should_retry_2, test_query_5xx_retried_exactly_twice) |
| M4 drop the 404 stop in refetchInterval | killed (test_polling_stops_when_running_run_then_404) |
| M5 manual setInterval + refetch() polling (cancelRefetch, overlapping requests) | killed, but the overlap test died by the **60 s timeout** (settle() never goes quiet because aborted requests never emit request:end), not by the maxInflight assertion |
| M6 shouldRetry retries 4xx | killed (6 tests) |
| M7 `pending` runs not polled (only `running`) | **SURVIVED** |
| M8 useAll* pages until an empty page | killed |
| M9 useAll* drops the abort signal | SURVIVED (not claimed by any test; low impact) |
| M10 keep polling after `done` | killed |

Judgement on the `tick`/`settle` helper: it does not hide retry-count or overlap bugs (M3/M5/M6 killed; retry tests now run on real timers with retryDelay 0 and waitFor(isError), so counts are final). Gaps it leaves: (a) the 1500 ms interval itself is not pinned: any interval in roughly (875, 2333] ms passes (`test_polls_every_1500ms...` only counts 3 requests in 10 s and `test_stops_on_unmount` counts 2 in 1750 ms); (b) a run in `pending` is never exercised, so dropping `pending` from the polling condition (the state POST /runs actually returns) survives; (c) an overlap bug manifests as a 60 s hang instead of a readable assertion. None of these is a product bug today (hooks.ts:205-209 is correct); they are test-strength notes for Task 6, which owns the polling UI tests.

### 2. Interfaces vs plan (Tasks 3-5)
Matches: `validateResumeInput({name,text,file}): string|null` and `educationLabel(level)` (lib/validation.ts:12, :37, labels None..Doctorate, "Unknown" otherwise incl. non-integers); limits exported as MAX_TEXT/MAX_FILE_BYTES/MAX_NAME/ALLOWED_SUFFIXES (validation.ts:1-4). `DataTable<T>` props exactly `{columns:{key,header,render,sortValue?}[], rows, pageSize?=25, emptyMessage, getRowId}` (DataTable.tsx:11-24). `Pagination({page, pageCount?, hasNext?, onPageChange})` (Pagination.tsx:9-14; not pinned by the plan, documented for Task 6). `OpportunityForm()`, `DemographicsEditor({candidateId})`, `SimilarCandidates({opportunityId})` as pinned. theme.ts exports `ALGORITHM_COLORS: Record<AlgorithmName,string>`, `INK`, `SURFACE: Record<Mode,string>` (theme.ts:13-56). `ComparisonCharts({metrics})`, `FairnessCharts({fairness, skippedReason?})`, `BreakdownBar({breakdown})`, `StatusBadge({status:"pass"|"fail", label})`, `DEFAULT_WEIGHTS` (BreakdownBar.tsx:14) all present.

MISMATCHES / deviations Task 6 must know about (none blocking):
- M-a `ChartFrame` (ChartFrame.tsx:18-28) requires an extra `summary: string` prop and takes optional `legend`; the plan pins `{title, description, table, children}`. A Task 6 caller using only the pinned props will not type-check. `table` is `{caption?, headers: string[], rows: string[][]}` (strings only).
- M-b `ALGORITHM_COLORS`/`INK` values are `var(--series-1, #2a78d6)`-style CSS expressions, not hex (theme.ts:21-24, 48-56); fine for SVG/CSS fills, unusable where a literal hex is needed (canvas, contrast maths). Raw hexes are in `ALGORITHM_PALETTE`.
- M-c Export style is mixed: charts and ResumeForm are default exports; DataTable, Pagination, OpportunityForm, DemographicsEditor, SimilarCandidates are named exports.
- M-d Hooks take `PageParams {limit, offset}` not a page number (`useCandidates(page)` in the plan); Task 4 pages use them correctly.
- M-e The plan asked for a dev-only `/__charts` route guarded by `import.meta.env.DEV`; since App.tsx is frozen, Task 5 used a separate Vite entry (`frontend/charts-preview.html` -> `src/charts-preview.tsx` -> `src/pages/__ChartsPreview.tsx`). Not in the production build (verified), acceptable.

### 3. Seams between the parallel agents
- educationLabel: single implementation (validation.ts:37); lib/education.ts only builds select options from it. No duplicate. OK.
- Limit constants: TWO sources of truth. validation.ts exports MAX_TEXT=20000/MAX_NAME=200, but OpportunityForm.tsx:28,30,34,37 hard-code 200/20000/10000/80 and DemographicsEditor.tsx:23 hard-codes 64. Values agree with the API today; recommend one `lib/limits.ts` (non-blocking).
- Error helpers: lib/errors.ts `errorMessage` (Task 4) vs inline `err instanceof ApiError ? err.detail : ...` (ResumeForm.tsx:36, Profile.tsx:23). Equivalent output because `ApiError.message === detail` (client.ts:7); fallbacks differ ("Something went wrong." vs "Something went wrong. Please try again."). Cosmetic.
- Loading states differ: Task 4 pages `<p>Loading...</p>` without a live region (Opportunities.tsx:20, Candidates.tsx:18, OpportunityDetail.tsx:17, CandidateDetail.tsx:17, SimilarCandidates.tsx:29); Profile uses `aria-live` and an ellipsis character (Profile.tsx:12). Error states are consistent (role="alert" + Retry).
- Hook shapes: SimilarCandidates uses `useAllCandidates().data` as an array and `.truncated` correctly (SimilarCandidates.tsx:11-12,27). OK.
- Page size: admin lists request `limit=25` (within the API's 1..100) and page server-side with `hasNext = rows.length >= 25`; DataTable then never shows its own pager for these lists. Consequence: column sorting only reorders the current 25-row server page (Opportunities.tsx:14,33; Candidates.tsx:13,31), which a user will read as a global sort. Non-blocking UX note; Task 6 lists (200-candidate fixture) should use client-side pagination of `useAll*` data instead if global sort is wanted.
- Routes: Profile, Opportunities, OpportunityDetail, Candidates, CandidateDetail are real; Runs/RunDetail still stubs by design; App.tsx unchanged vs HEAD; Layout nav links (/runs, /opportunities, /candidates, /profile) all resolve.

### 4. Privacy and role rules (throwaway `src/__judge_tmp__/privacy.test.tsx`, 18/18 pass, deleted afterwards)
Setup already has MSW `onUnhandledRequest: "error"` and console.error/warn throwing; the tests also record every `request:start`.
- Candidate token through the real route table on /opportunities, /opportunities/1, /candidates, /candidates/1, /runs, /runs/1 (+ /candidates/1/demographics -> NotFound): Forbidden heading each time, **zero requests**.
- Candidate on /profile: exactly `["GET /api/candidates/me"]`; no demographics or list call; no group/demographic text.
- Admin on /profile: "Admins manage candidates from the Candidates page" shown, **zero requests** (no /candidates/me), no resume form.
- Group labels: only DemographicsEditor (CandidateDetail, admin route) and the charts (Task 6 admin page) read them; `useDemographics` has no other caller.
- Resume text: `resume_text` appears only as a FormData field (ResumeForm.tsx:28); `raw_text` nowhere; nothing renders resume text.
- Hostile strings (`<img onerror>`, `<script>`, RTL override + Hebrew/Arabic, emoji ZWJ, 5000-char) rendered through Profile, Candidates, CandidateDetail (+DemographicsEditor), Opportunities, OpportunityDetail (+SimilarCandidates), FairnessCharts, BreakdownBar chips, ComparisonCharts, DataTable: no `<img>`/`<script>` created, `window.__xss` undefined, text present, full text in `title` where truncated (chips `truncate`, headings `break-words`, DataTable cell `max-w-[16rem] truncate`, posting `whitespace-pre-wrap break-words`).
- Overflow gaps (jsdom cannot measure; by class inspection): DemographicsEditor "Current:" value has no `break-words` (DemographicsEditor.tsx:38-44), so a 64-char unbroken label overflows a 360px viewport; OpportunityForm server-error region has no `break-words` (OpportunityForm.tsx:104). Non-blocking.

### 5. Forms (throwaway `src/__judge_tmp__/forms.test.tsx`, 52/52 pass, deleted afterwards)
ResumeForm / validateResumeInput: 20000 ok / 20001 rejected; 5 MiB ok / +1 rejected; 0-byte `a.pdf` rejected with visible "The file is empty."; name 200/201; whitespace-only name rejected; whitespace-only text with no file rejected (and treated as "no text" when a file is chosen); NUL in name/text rejected; `RESUME.DOCX` ok, `a.pdf.exe` and suffix-less rejected; names with `\`, `/`, `..` and CJK accepted (suffix from the last dot; server re-derives it). `accept=".pdf,.docx,.txt"`. `form.requestSubmit()` twice -> ONE POST; 503 detail shown verbatim inside the `aria-live` status (HTML in detail stays text); values kept; a retry after the error sends exactly one more; 409 -> `onConflict` once; upload sends `name` trimmed, a `resume` part and NO `resume_text`.
OpportunityForm: capacity 0/10001/NaN/1.5/1e3/-1/empty rejected, 1/10000/" 007 " accepted (posts 7); min experience 0/80/2.5 ok, 81/-1/1e1/80.0000001 rejected; education select options exactly 0..4 and posts the int; title 200/201, whitespace, NUL; text 20000/20001, whitespace, NUL. requestSubmit x2 + Enter x3 -> ONE request; 503/409 details verbatim in the live region; values kept after error; success clears fields.
Findings (non-blocking):
- F-a Lengths are counted in UTF-16 units (`.length`) while the API counts code points: 10001 emoji (20002 units) is rejected client-side although the server accepts it (validation.ts:20, OpportunityForm.tsx:28,30, DemographicsEditor.tsx:23). Stricter, not unsafe; use `[...s].length` if parity matters.
- F-b OpportunityForm success is silent: no live-region text after a create (OpportunityForm.tsx:47-53, 104-106); the plan requires async status changes announced. Add "Opportunity created." to the live region.
- F-c DemographicsEditor has no in-flight guard: two synchronous submits send TWO PUTs (button disables only after TanStack's async notify) (DemographicsEditor.tsx:19-30). Idempotent, so harmless, but inconsistent with the other forms' `busy` ref.
- F-d ResumeForm's validation message (ResumeForm.tsx:92) is neither in a live region nor tied to inputs via `aria-describedby`/`aria-invalid`, and the submit stays disabled, so a screen-reader user gets no reason why; OpportunityForm does this correctly (per-field role="alert" + aria-describedby). No focus is moved to the first invalid field or to the error after a server rejection in either form.
- F-e Name length check uses the untrimmed value (validation.ts:15) while the API trims first; " " + 200 chars is rejected client-side. Cosmetic.

### 6. DataTable / Pagination (throwaway `src/__judge_tmp__/table.test.tsx`, 5/5 pass, deleted)
- Sort is stable in both directions (index tie-break, DataTable.tsx:58-66); `undefined` and `NaN` sort last in BOTH directions; aria-sort cycles none -> ascending -> descending on sortable headers only; non-sortable headers carry no aria-sort; header buttons are real buttons (keyboard OK); sorting resets to page 1.
- 60 rows -> 3 pages; shrinking rows clamps the visible page (60 -> 30 rows shows "Page 2 of 2"); <= 25 rows hides the pager; empty rows show `emptyMessage`. The clamped page is not written back to state, so when rows grow again the table jumps back to the old page (DataTable.tsx:51,71). Minor.
- 1000 rows: first render + one sort in ~100 ms (< 2 s); only 25 rows in the DOM. Cell HTML stays text; long string cells get `title` + `truncate` (DataTable.tsx:37-47). Only string/number cell output is truncated; ReactNode cells (links, badges) are not.
- Mixed-type sort values fall back to `String.localeCompare` without `{numeric:true}`, so "Job 10" sorts before "Job 2" (DataTable.tsx:32-35). Non-blocking; Task 6 should sort ids/scores with numeric sortValue (it will).
- Pagination clamps `page` into 1..pageCount, server mode ("Page N" + hasNext) works, buttons labelled "Previous page"/"Next page" (visible text contained in the name), status text in `aria-live`.
- Hook pagination: Opportunities/Candidates request `limit=25&offset=(page-1)*25` (Admin.test asserts 25/0 then 25/25); `useAll*` page with limit=100 until a short page (hooks test + mutant M8).

### 7. Charts (rubric: dataviz SKILL.md + references/anti-patterns.md, marks-and-anatomy.md, palette.md)
Throwaway `src/__judge_tmp__/charts.test.tsx` (26/26 after recording findings) and `zero.test.tsx`; own screenshots taken.

(a) Palette validator re-run (skill 2.1.314 `scripts/validate_palette.js`, identical to 2.1.317): `#2a78d6,#eb6834` light (adjacent and `--pairs all`) ALL PASS, CVD 24.7 / normal 33.6; `#3987e5,#d95926` dark ALL PASS, 26.8 / 31.8; breakdown `#1baf7a,#eda100,#e87ba4,#008300` light PASS with WARN contrast aqua 2.74, yellow 2.11, magenta 2.62; dark `#199e70,#c98500,#d55181,#008300` ALL PASS (CVD 8.4, normal 19.3). Exactly matches PALETTE.md. Hexes match the skill's palette.md slots 1-6 in both modes; status colours match the skill's fixed status palette.

(b) No dual axis anywhere: each ComparisonCharts metric is its own small multiple with its own YAxis (ComparisonCharts.tsx:66-118); FairnessCharts has one 0..1 x-axis. Colour follows the algorithm key, never the index (ComparisonCharts.tsx:107, FairnessCharts.tsx:216); verified a GS-only payload renders only `--series-2` fills. Legend for >=2 series only (ChartFrame.tsx:33). Tooltips on every Recharts chart and on breakdown segments. Table toggle has the same numbers as the labels/aria-label (verified 4.20/4.00), and the view change is announced (sr-only status).

(c) Four-fifths badge. The client derives pass/fail from `ratio >= 0.8 - 1e-9` (FairnessCharts.tsx:242 and :342) and ignores `passes_four_fifths`, which the zod schema already requires (types.ts:54). Evidence: (1) the 5 saved real RunOut payloads (both/hungarian/gs, with and without demographics, generated in-process by the earlier judge via the real API) all render with the badge equal to the server flag and the skipped reason shown verbatim; (2) brute force through the server's own `core.fairness.audit` (exact Fractions, JSON round-trip) over every 2-group configuration with sizes 1..25 and every 3-group configuration with sizes 1..8 (207,684 reports, 952 exactly at 0.8 incl. 4/12 vs 5/12): **0 disagreements**; (3) proof it cannot happen for any payload the server can produce: ratio = s1*n2/(s2*n1) with s2*n1 <= candidates x seats <= MAX_CELLS = 25e6 (api/services/runs.py:25,38), so a ratio below 0.8 is at least 1/(5*25e6) = 8e-9 below it, outside the 1e-9 epsilon. So the badge can NOT contradict the server today: not blocking. It still should use the flag (single source of truth; an inconsistent payload `ratio 0.9, passes false` shows Pass today). **But the displayed number can contradict the badge** (see B2): ratio 35/44 = 0.7955 (group A 4 of 5 selected, group B 7 of 11; a 16-candidate run) renders hero "0.80" next to "Fails four-fifths rule" while the caption says "0.8 or above passes" (FairnessCharts.tsx:266, :273, :340).

(d) WCAG contrast of every text-on-fill pair (computed, scratchpad `contrast.js`; confirmed in Chromium computed styles: the label "0.33" is 12px semibold white on rgb(27,175,122)):
| Pair | Light | Dark | Need |
|---|---|---|---|
| Semantic segment label: white on aqua | **2.82 FAIL** | **3.41 FAIL** | 4.5 (12px) |
| Skills label: #0b0b0b on yellow | 9.09 | 6.41 | 4.5 |
| Experience label: white on magenta | **2.69 FAIL** | **3.94 FAIL** | 4.5 (latent: max contribution 0.1 < the 0.15 label threshold, so never printed with default weights) |
| Education label: white on green | 4.95 | 4.95 | 4.5 (latent, same reason) |
| near-black on aqua (fix candidate) | 6.99 | 5.78 | |
| near-black on magenta (fix candidate) | 7.31 | 4.99 | |
| Muted ink #898781 on surface (12px axis ticks, 0 / 1.00 scale) | **3.50 FAIL** | 4.85 | 4.5 |
| Primary / secondary ink on surface | 19.17 / 7.73 | 15.15 / 9.72 | 4.5 |
| Selected toggle: primary on track | 16.49 | 12.51 | 4.5 |
| Status icons on surface (graphics) | good 3.27, critical 4.68 | 5.19, 3.62 | 3.0 |
The Semantic label is printed whenever semantic*0.4 >= 0.15, i.e. on most real allocations (real payload: 0.17), so body-size text fails: **B1**. Muted axis ticks at 3.5:1 are the skill's own token; non-blocking but recommend secondary ink for tick text.

(e) Real payload breakdowns: field names exactly `semantic, skill_overlap, experience, education, matched_skills, related_skills, total`; signal x DEFAULT_WEIGHTS sums to `total` within 4.7e-7 (< 1e-3) for every real allocation; no custom-weights note; no error panel. The note's tolerance is 0.01 (BreakdownBar.tsx:29), looser than the plan's 1e-3 (a 0.005 discrepancy is silently drawn as default weights). Non-blocking.

(f) Malformed data: NaN/negative/>1/empty groups, NaN ratio, Infinity parity, NaN/negative/>1 breakdown parts, NaN total, NaN/negative metrics, `{}` metrics: all render a role="alert" ChartError, no throw, no "NaN"/"Infinity" text. Size-0 group: no NaN. 13 groups fold to 11 + "Other" (12 rows). Long group label: SVG `<title>` with full text, tick truncated at 18 chars. **Zero-valued bar: NOT labelled** (B3): Recharts draws no rectangle and no LabelList text for value 0 (jsdom and Chromium agree: H=2/GS=0 shows labels ["2"]); with the real payloads (both algorithms have 0 blocking pairs, and Gale-Shapley is always 0 by construction) the "Blocking pairs" chart is an empty plot with no marks and no numbers. Task 5's report claims "value label still shown"; the screenshot shows it is not. The existing tests deliberately avoid zeros (ComparisonCharts.test.tsx:30-34).
Edge: a real group literally named "Other" plus folding would merge two rows into one Map entry (FairnessCharts.tsx:76-88). Non-blocking.

(g) The four breakdown segment `<button>`s sit inside `role="img"` (ChartFrame.tsx:122; BreakdownBar.tsx:144). Children of role=img are presentational, so screen readers will not expose them; sighted keyboard users can still Tab to them and get the tooltip, and the aria-label summary plus the Table view carry every value. Not blocking; recommend moving interactive children out of the img (role="group" with aria-label) or making the segments non-focusable.

(h) Own screenshots (Playwright chromium-1248 via executablePath, dev server `timeout 120 vite --port 5199`, killed by PID afterwards, port 5199 confirmed free, port 8000 untouched): `judge-desktop-light.png`, `judge-desktop-dark.png`, `judge-360-light.png`, `judge-360-dark.png` in the scratchpad. Measured: 0 px horizontal overflow at 360 and 1200 in both themes, 0 overlapping SVG text boxes, no element past the viewport; console only a favicon 404. Visual: GS bar slot in "Blocking pairs" is empty (B3); "Blocking pairs" card toolbar wraps under its description on desktop while the other two cards keep it inline (cosmetic); at 360px the 120px group-label column leaves a narrow plot but bars stay legible.
Note: `.viz-root` follows `prefers-color-scheme` (charts.css:22-38) but the app has no dark theme, so in an OS-dark browser the chart cards become dark islands on the white app (ChartFrame/ChartError/null-fairness card set their own background). Recommend keying dark tokens to `[data-theme="dark"]` only until the app has a dark mode.

### 8. Accessibility sweep (new pages/components)
- Labels: every input/select/textarea has a `<label for>` or wrapping label (ResumeForm Name/Resume text/Resume file; OpportunityForm 5 fields; DemographicsEditor "Group label"; SimilarCandidates "Show top" select); chart toggles are buttons with aria-pressed in a labelled group; sort headers and pager are real buttons with names. OK.
- Live regions: ResumeForm status (pending + server error), OpportunityForm server error, DemographicsEditor "Saved.", Pagination page text, ChartFrame view announcement. Gaps: OpportunityForm success silent (F-b); Task 4 loading text not live; ResumeForm validation reason not announced or associated (F-d).
- Focus management: none after submit/error in any form, and after the ResumeForm is replaced by the profile focus falls to `<body>`. Non-blocking (not pinned by the plan), recommended for Task 7 polish.
- Keyboard: all toggles, sort headers, pager, limit select, remove-file reachable and operable; breakdown segments focusable (see 7g).
- Headings: Profile h1 > h2; Opportunities h1 > h2 "New opportunity"; detail pages h1 (title/name) > h2 sections; charts h3 (ChartFrame) > h4 (DisparatePanel, chips). Detail pages render NO h1 while loading, on error or for an invalid id (OpportunityDetail.tsx:14-22, CandidateDetail.tsx:14-22). Minor.
- Colour never alone: StatusBadge icon + text; "Basic mode" text badge; legends with text; segment identity via legend + tooltip + table. OK.
- Contrast: see 7(d) (B1; muted tick note).

### 9. Regressions and hygiene
- Task 1/2 tests all pass inside the 277 (App, client, token, redirect, RequireRole, Login, Register, ErrorBoundary, hooks, types).
- Backend: `python -m pytest tests/api/test_openapi_snapshot.py -q` -> 3 passed.
- No console.log/debug/TODO (check 1a).
- Ownership (git status): every new/modified file is in the listed Task 2-cleanup/3/4/5 sets, except: `.gitignore` (+ `.claude/settings.local.json`, belongs to no task: commit separately or drop from the wave commit); `frontend/src/pages/Login.test.tsx` and `Register.test.tsx` show `M` but `git diff` is empty (line-ending/stat only; nothing to commit). Pagination.tsx and ChartTooltip.tsx have no test file of their own ("tests beside each"); both are exercised through DataTable/Admin and chart tests.
- Report accuracy: Task 5 report says a zero bar's "value label still shown"; my Chromium screenshot and jsdom both show no label (B3). Task 4 report's two failing App.test cases were fixed by the Task 2 follow-up (now pass).
