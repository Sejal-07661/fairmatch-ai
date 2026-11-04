// Task 6: import { ALGORITHM_COLORS, INK, SURFACE } from "../components/charts/theme";  (named exports; colours are var() strings)
import type { AlgorithmName } from "../../api/types";

/**
 * Chart design tokens. The hex values are the validated palette from the dataviz
 * skill (see PALETTE.md). Light and dark are two SELECTED sets, not a flipped light
 * set: `charts.css` defines both as custom properties on `.viz-root`, and the
 * constants below that components consume are `var()` references with the light
 * value as a fallback, so the same markup renders correctly in either mode.
 */

export type Mode = "light" | "dark";

export const SURFACE: Record<Mode, string> = { light: "#fcfcfb", dark: "#1a1a19" };

/** Fixed entity colours: Hungarian = categorical series 1, Gale-Shapley = series 2. */
export const ALGORITHM_PALETTE: Record<Mode, Record<AlgorithmName, string>> = {
  light: { hungarian: "#2a78d6", gale_shapley: "#eb6834" },
  dark: { hungarian: "#3987e5", gale_shapley: "#d95926" },
};

export const ALGORITHM_COLORS: Record<AlgorithmName, string> = {
  hungarian: `var(--series-1, ${ALGORITHM_PALETTE.light.hungarian})`,
  gale_shapley: `var(--series-2, ${ALGORITHM_PALETTE.light.gale_shapley})`,
};

export type BreakdownPart = "semantic" | "skill_overlap" | "experience" | "education";
export const BREAKDOWN_PARTS: readonly BreakdownPart[] = [
  "semantic",
  "skill_overlap",
  "experience",
  "education",
];

/** Categorical slots 3 to 6 (aqua, yellow, magenta, green), kept off the algorithm hues. */
export const BREAKDOWN_PALETTE: Record<Mode, Record<BreakdownPart, string>> = {
  light: { semantic: "#1baf7a", skill_overlap: "#eda100", experience: "#e87ba4", education: "#008300" },
  dark: { semantic: "#199e70", skill_overlap: "#c98500", experience: "#d55181", education: "#008300" },
};

export const BREAKDOWN_COLORS: Record<BreakdownPart, string> = {
  semantic: `var(--seg-1, ${BREAKDOWN_PALETTE.light.semantic})`,
  skill_overlap: `var(--seg-2, ${BREAKDOWN_PALETTE.light.skill_overlap})`,
  experience: `var(--seg-3, ${BREAKDOWN_PALETTE.light.experience})`,
  education: `var(--seg-4, ${BREAKDOWN_PALETTE.light.education})`,
};

/** Text in ink tokens, never in series colours. */
export const INK = {
  primary: "var(--ink-primary, #0b0b0b)",
  secondary: "var(--ink-secondary, #52514e)",
  muted: "var(--ink-muted, #898781)",
  grid: "var(--grid, #e1e0d9)",
  axis: "var(--axis, #c3c2b7)",
  track: "var(--track, #ecebe6)",
  surface: "var(--surface-1, #fcfcfb)",
} as const;

/** Status colours are fixed and never themed; always shown with an icon and a label. */
export const STATUS = { good: "#0ca30c", critical: "#d03b3b" } as const;

/**
 * Label inside a coloured fill, chosen per fill so that 12px text clears WCAG 4.5:1
 * in BOTH modes (checked by contrast.test.ts): near-black on aqua, yellow and magenta,
 * white on green. The palette's generic "white except yellow" rule fails on aqua/magenta.
 */
export const SEGMENT_TEXT: Record<BreakdownPart, string> = {
  semantic: "#0b0b0b",
  skill_overlap: "#0b0b0b",
  experience: "#0b0b0b",
  education: "#ffffff",
};

/** Raw ink hexes per mode (the CSS variables in charts.css carry the same values). */
export const INK_PALETTE: Record<Mode, { primary: string; secondary: string; muted: string }> = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781" },
  dark: { primary: "#f0efec", secondary: "#c3c2b7", muted: "#898781" },
};

/** Bars are capped; the rest of the band is air. */
export const MAX_BAR = 24;
export const BAR_RADIUS = 4;
export const SURFACE_GAP = 2;
/** Maximum groups drawn per chart; extra groups are folded into "Other". */
export const MAX_GROUPS = 12;

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
