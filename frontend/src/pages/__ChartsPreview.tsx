import { useEffect, useState } from "react";
import { makeFairness, makeMetrics } from "../test/fixtures";
import BreakdownBar from "../components/charts/BreakdownBar";
import ComparisonCharts from "../components/charts/ComparisonCharts";
import FairnessCharts from "../components/charts/FairnessCharts";
import type { FairnessGroup } from "../api/types";

/**
 * Dev-only preview of every chart with fixture data. Not routed in App.tsx; it is
 * mounted by charts-preview.html (served by `npm run dev`, absent from the build).
 */
const manyGroups: FairnessGroup[] = Array.from({ length: 15 }, (_, i) => ({
  group: i === 2 ? "A very long demographic group label that overflows the axis" : `Group ${i + 1}`,
  size: 30 - i,
  selected: 10 - (i % 5),
  selection_rate: (10 - (i % 5)) / (30 - i),
  mean_score: 0.6,
}));

export default function ChartsPreview() {
  const [dark, setDark] = useState(() => new URLSearchParams(location.search).get("theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const base = makeFairness();
  const fairness = {
    hungarian: { ...base.hungarian!, disparate_impact_ratio: 0.67, passes_four_fifths: false, groups: manyGroups },
    gale_shapley: { ...base.gale_shapley!, disparate_impact_ratio: 0.8, groups: manyGroups.map((g) => ({ ...g, selection_rate: Math.min(1, g.selection_rate * 1.2) })) },
  };
  return (
    <main className="viz-root mx-auto grid max-w-5xl gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="m-0 text-xl font-semibold">Charts preview (dev only)</h1>
        <button
          type="button"
          aria-pressed={dark}
          onClick={() => setDark((d) => !d)}
          className="rounded-md border px-3 py-1 text-sm"
        >
          Dark theme
        </button>
      </header>
      <section aria-label="Comparison" className="grid gap-2">
        <h2 className="m-0 text-lg font-semibold">Comparison</h2>
        <ComparisonCharts metrics={makeMetrics()} />
        <h3 className="m-0 text-sm">Only Hungarian</h3>
        <ComparisonCharts metrics={makeMetrics({ gale_shapley: undefined })} />
      </section>
      <section aria-label="Fairness" className="grid gap-2">
        <h2 className="m-0 text-lg font-semibold">Fairness</h2>
        <FairnessCharts fairness={fairness} />
        <FairnessCharts fairness={null} skippedReason="No demographics recorded for these candidates" />
      </section>
      <section aria-label="Breakdown" className="grid gap-2">
        <h2 className="m-0 text-lg font-semibold">Breakdown</h2>
        <BreakdownBar
          breakdown={{
            semantic: 0.82,
            skill_overlap: 0.5,
            experience: 0.3,
            education: 0.67,
            matched_skills: ["python", "sql", "machine learning"],
            related_skills: [["pandas", "numpy"]],
            total: 0.625,
          }}
        />
      </section>
    </main>
  );
}
