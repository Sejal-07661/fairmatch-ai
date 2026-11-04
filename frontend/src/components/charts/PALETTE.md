# Chart palette validation

Source: dataviz skill `references/palette.md`. Hungarian = categorical slot 1, Gale-Shapley = slot 2 (fixed, never cycled). Score breakdown parts use slots 3 to 6 (aqua, yellow, magenta, green) so they never impersonate an algorithm. Light and dark are two selected sets (dark hexes from the palette's dark column), defined in `charts.css`.

Run from `frontend/`; `$D` is the skill directory.

| Command | Result |
|---|---|
| `node $D/scripts/validate_palette.js "#2a78d6,#eb6834" --mode light` | all checks PASS (CVD dE 24.7, normal 33.6) |
| `node $D/scripts/validate_palette.js "#2a78d6,#eb6834" --mode light --pairs all` | all PASS |
| `node $D/scripts/validate_palette.js "#3987e5,#d95926" --mode dark` | all PASS (CVD 26.8, normal 31.8) |
| `node $D/scripts/validate_palette.js "#3987e5,#d95926" --mode dark --pairs all` | all PASS |
| `node $D/scripts/validate_palette.js "#1baf7a,#eda100,#e87ba4,#008300" --mode light` | PASS; WARN contrast below 3:1 for aqua 2.74, yellow 2.11, magenta 2.62 (relief: legend, tooltip, table view, printed values) |
| `node $D/scripts/validate_palette.js "#199e70,#c98500,#d55181,#008300" --mode dark` | all PASS (CVD 8.4, normal 19.3) |

A first dark run with the LIGHT hexes (`#2a78d6,#eb6834`) FAILED the lightness band (`#eb6834` L 0.671). Fixed by selecting the dark column values above, not by flipping.

Status colours (good `#0ca30c`, critical `#d03b3b`) are fixed, used only in `StatusBadge` with an icon and a label. Text uses ink tokens, never series colours.

Rules applied: bars at most 24px with 4px rounded data ends, 2px surface gaps, hairline recessive grid, legend for two or more series, labels only on the bars that need them, tooltips on whole category bands, table view for every chart. Groups: at most 12 per selection-rate chart; beyond that the 11 largest stay and the rest fold into "Other".

## Fix round (judge wave 1)

- Segment label text is chosen per fill and checked by `contrast.test.ts` (WCAG, both modes, 4.5:1 for 12px text): near-black `#0b0b0b` on aqua, yellow and magenta (black on aqua 6.99 light / 5.78 dark, on magenta 7.31 / 4.99, per the judge; yellow and green asserted by the test), white on green. The palette's generic "white except yellow" label rule fails on aqua and magenta, so it is not used.
- Axis ticks and scale text use secondary ink (muted `#898781` is 3.5:1 on the light surface and was dropped for text).
- Validator re-run (light and dark, same commands as above): light 2-series PASS; dark 2-series PASS; breakdown light PASS with the same contrast WARN (relieved by values in tooltip, table view and now readable inline labels); breakdown dark PASS.
- Interface notes for Task 6: `ChartFrame` requires `summary` and takes `legend`; `ALGORITHM_COLORS`, `BREAKDOWN_COLORS` and `INK` are CSS `var(--x, fallback)` strings (hex in `*_PALETTE`).
