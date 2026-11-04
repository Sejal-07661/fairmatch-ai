# M3 Task 5 report: charts

Status: done. Files in `frontend/src/components/charts/` (theme.ts, charts.css, ChartFrame, ChartTooltip, ComparisonCharts, FairnessCharts, BreakdownBar, StatusBadge, PALETTE.md, tests), plus `src/pages/__ChartsPreview.tsx`, `src/charts-preview.tsx`, `charts-preview.html` (dev server only, not in build input).

Commands: charts tests 63 pass; full `npm test` 272 pass, 2 fail in `src/App.test.tsx` (admin route tests for `/opportunities/3`, `/candidates/3`, owned by the parallel admin agent, not charts); typecheck and lint clean; build OK.

Palette: light and dark validators pass (see PALETTE.md); only WARN is light contrast for aqua/yellow/magenta, relieved by legend, tooltip, table view and inline values.

Screenshot (Playwright's chromium-1248 full chrome, desktop light/dark and 360px): no horizontal overflow, no label collisions, long group name truncated with title, 12-group cap folds into Other. Fixes made after looking: integer y ticks for blocking pairs, shorter description so card toolbars align, consistent preview data.

Decisions and concerns:
- Pass/fail uses ratio >= 0.8 (epsilon 1e-9), not the server flag.
- A zero-valued bar draws no rectangle (value label still shown).
- Breakdown segments are focusable buttons inside the chart's role="img" wrapper so keyboard tooltips work; the table view is the full accessible twin.
- White label text on aqua segment is below 3:1 (palette rule).

## Fix note (judge wave 1: B1, B2, B3)

- Correction: the earlier claim that a zero bar's "value label still shown" was wrong. Fixed in B3.
- B1: segment label text is now #0b0b0b on aqua, yellow and magenta, white on green; `contrast.test.ts` computes WCAG contrast for every text-on-fill pair (both modes, 4.5:1) plus ink-on-surface and series fills (3:1). Muted axis/scale text switched to secondary ink. PALETTE.md updated; validators re-run (light/dark pass, same light-contrast WARN for aqua/yellow/magenta fills, relieved by readable labels, tooltip and table).
- B2: ratio shown floored to 3 decimals (35/44 shows 0.795), pass/fail from `passes_four_fifths` (ratio >= 0.8 only if the flag is missing), caption says the server marks >= 0.8 as passing. Tests added.
- B3: `minPointSize={2}` gives zero bars a visible 2px stub and the "0" label; tests for all-zero and mixed-zero (mutation-checked: fail without the fix), table shows 0.
- Non-blocking applied: Task 6 interface and import comments in each component file and PALETTE.md; muted ticks to secondary ink.
- Skipped: role="img" wrapping the breakdown buttons (needs a ChartFrame redesign), custom-weights tolerance 0.01 vs 1e-3 (kept, documented), dark tokens keyed only to [data-theme] (app has no theme toggle; left to Task 7), a real group literally named "Other" merging (rare), Blocking-pairs toolbar wrap (fixed incidentally by the shorter description).
