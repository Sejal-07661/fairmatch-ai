import {
  ALGORITHM_LABELS,
  parseRunFairness,
  parseRunMetrics,
  parseScoreBreakdown,
} from "./types";
import { makeAllocation, makeFairness, makeMetrics } from "../test/fixtures";

describe("types", () => {
  it("test_labels", () => {
    expect(ALGORITHM_LABELS).toEqual({ hungarian: "Hungarian", gale_shapley: "Gale-Shapley" });
  });
  it("test_metrics_accepts_fixture", () => {
    expect(parseRunMetrics(makeMetrics()).ok).toBe(true);
  });
  it("test_metrics_optional_algorithms_and_skipped", () => {
    expect(parseRunMetrics({ fairness_skipped: "no demographics" })).toEqual({
      ok: true,
      data: { fairness_skipped: "no demographics" },
    });
    expect(parseRunMetrics({}).ok).toBe(true);
  });
  it("test_metrics_rejects_missing_unallocated", () => {
    const bad = { hungarian: { total_score: 1, blocking_pairs: 0, runtime_ms: 1 } };
    expect(parseRunMetrics(bad).ok).toBe(false);
  });
  it("test_metrics_rejects_string_total_score", () => {
    const m = makeMetrics();
    expect(parseRunMetrics({ hungarian: { ...m.hungarian, total_score: "4.2" } }).ok).toBe(false);
  });
  it("test_metrics_rejects_non_finite", () => {
    const m = makeMetrics();
    expect(parseRunMetrics({ hungarian: { ...m.hungarian, runtime_ms: Infinity } }).ok).toBe(false);
    expect(parseRunMetrics({ hungarian: { ...m.hungarian, total_score: NaN } }).ok).toBe(false);
  });
  it("test_metrics_ignores_unknown_keys", () => {
    const r = parseRunMetrics({ ...makeMetrics(), mystery: { total_score: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data)).not.toContain("mystery");
  });
  it("test_fairness_accepts_fixture_and_null", () => {
    expect(parseRunFairness(makeFairness()).ok).toBe(true);
    expect(parseRunFairness(null)).toEqual({ ok: true, data: null });
  });
  it("test_fairness_rejects_bad_group", () => {
    const f = makeFairness();
    const bad = { hungarian: { ...f.hungarian, groups: [{ group: "A" }] } };
    expect(parseRunFairness(bad).ok).toBe(false);
  });
  it("test_breakdown", () => {
    expect(parseScoreBreakdown(makeAllocation().breakdown).ok).toBe(true);
    const b = { ...makeAllocation().breakdown, related_skills: [["a"]] };
    expect(parseScoreBreakdown(b).ok).toBe(false);
  });
  it.each([null, 42, [], "str", undefined, true, { a: 1 }])("test_parsers_never_throw_%s", (v) => {
    for (const p of [parseRunMetrics, parseRunFairness, parseScoreBreakdown]) {
      const r = p(v);
      expect(typeof r.ok).toBe("boolean");
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    expect(parseRunMetrics(null).ok).toBe(false);
    expect(parseRunMetrics(42).ok).toBe(false);
    expect(parseRunMetrics([]).ok).toBe(false);
  });
});
