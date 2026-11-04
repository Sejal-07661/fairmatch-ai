import { formatElapsed, formatTimestamp, parseApiDate } from "./format";

describe("parseApiDate", () => {
  it("treats a naive ISO string as UTC", () => {
    expect(parseApiDate("2026-11-04T09:16:24.526954")?.toISOString()).toBe("2026-11-04T09:16:24.526Z");
    expect(parseApiDate("2026-11-04 09:16:24")?.toISOString()).toBe("2026-11-04T09:16:24.000Z");
  });
  it("respects Z and explicit offsets", () => {
    expect(parseApiDate("2026-11-04T09:00:00Z")?.toISOString()).toBe("2026-11-04T09:00:00.000Z");
    expect(parseApiDate("2026-11-04T09:00:00+02:00")?.toISOString()).toBe("2026-11-04T07:00:00.000Z");
    expect(parseApiDate("2026-11-04T09:00:00-0500")?.toISOString()).toBe("2026-11-04T14:00:00.000Z");
  });
  it("returns null for unparseable values", () => {
    for (const v of ["", "nope", null, undefined, 5, {}, "2026-13-45T99:00:00"]) {
      expect(parseApiDate(v)).toBeNull();
    }
  });
});

describe("formatTimestamp", () => {
  it("returns local text and the raw value as title", () => {
    const r = formatTimestamp("2026-11-04T09:16:24");
    expect(r.title).toBe("2026-11-04T09:16:24");
    expect(r.text).not.toMatch(/Invalid|NaN/);
    expect(r.text).toMatch(/2026/);
  });
  it("shows unknown, never Invalid Date or NaN", () => {
    for (const v of ["garbage", null, undefined, ""]) {
      const r = formatTimestamp(v);
      expect(r.text).toBe("unknown");
      expect(r.text).not.toMatch(/Invalid|NaN/);
    }
  });
});

describe("formatElapsed", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59_400)).toBe("59s");
    expect(formatElapsed(61_000)).toBe("1m 01s");
    expect(formatElapsed(3_725_000)).toBe("1h 02m");
  });
  it("clamps negative and non-finite input", () => {
    expect(formatElapsed(-5000)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
  });
});
