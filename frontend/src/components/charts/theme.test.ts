import { describe, expect, it } from "vitest";
import {
  ALGORITHM_COLORS,
  ALGORITHM_PALETTE,
  BREAKDOWN_PALETTE,
  INK,
  MAX_GROUPS,
  SURFACE,
  truncate,
} from "./theme";

describe("theme", () => {
  it("fixes one colour per algorithm (series 1 and 2)", () => {
    expect(ALGORITHM_PALETTE.light.hungarian).toBe("#2a78d6");
    expect(ALGORITHM_PALETTE.light.gale_shapley).toBe("#eb6834");
    expect(ALGORITHM_PALETTE.dark.hungarian).toBe("#3987e5");
    expect(ALGORITHM_PALETTE.dark.gale_shapley).toBe("#d95926");
    expect(ALGORITHM_COLORS.hungarian).toContain("var(--series-1");
    expect(ALGORITHM_COLORS.gale_shapley).toContain("var(--series-2");
  });

  it("uses distinct breakdown colours, none equal to an algorithm colour", () => {
    const light = Object.values(BREAKDOWN_PALETTE.light);
    expect(new Set(light).size).toBe(4);
    for (const c of light) expect(Object.values(ALGORITHM_PALETTE.light)).not.toContain(c);
  });

  it("exposes surfaces and ink tokens", () => {
    expect(SURFACE.light).toBe("#fcfcfb");
    expect(SURFACE.dark).toBe("#1a1a19");
    expect(INK.primary).toContain("var(--ink-primary");
  });

  it("truncates long labels", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("abcdefghijkl", 8)).toBe("abcdefg…");
    expect(MAX_GROUPS).toBe(12);
  });
});
