import { describe, expect, it } from "vitest";
import { ALGORITHM_PALETTE, BREAKDOWN_PALETTE, BREAKDOWN_PARTS, INK_PALETTE, SEGMENT_TEXT, STATUS, SURFACE } from "./theme";
import type { Mode } from "./theme";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const NORMAL = 4.5; // 12px text
const LARGE = 3; // 24px+ text and non-text marks
const modes: Mode[] = ["light", "dark"];

describe("WCAG contrast of every text-on-fill pair the charts use", () => {
  it.each(modes)("segment labels on breakdown fills (%s) clear 4.5:1", (mode) => {
    for (const part of BREAKDOWN_PARTS) {
      const r = contrast(SEGMENT_TEXT[part], BREAKDOWN_PALETTE[mode][part]);
      expect(r, `${part} ${mode}`).toBeGreaterThanOrEqual(NORMAL);
    }
  });

  it.each(modes)("ink text on the chart surface (%s) clears 4.5:1", (mode) => {
    expect(contrast(INK_PALETTE[mode].primary, SURFACE[mode])).toBeGreaterThanOrEqual(NORMAL);
    // axis ticks, scale text, legend, descriptions and tooltip names use secondary ink
    expect(contrast(INK_PALETTE[mode].secondary, SURFACE[mode])).toBeGreaterThanOrEqual(NORMAL);
  });

  it.each(modes)("series fills and status icons (%s) clear 3:1 against the surface or are relieved", (mode) => {
    for (const c of Object.values(ALGORITHM_PALETTE[mode])) {
      expect(contrast(c, SURFACE[mode])).toBeGreaterThanOrEqual(LARGE);
    }
    // status colours are icon + label only; the label is ink text, checked above
    expect(contrast(STATUS.critical, SURFACE.light)).toBeGreaterThanOrEqual(LARGE);
  });
});
