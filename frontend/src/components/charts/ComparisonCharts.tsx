// Task 6: import ComparisonCharts from "../components/charts/ComparisonCharts";  (default export)
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALGORITHM_LABELS, ALGORITHM_NAMES } from "../../api/types";
import type { AlgorithmMetrics, AlgorithmName, RunMetrics } from "../../api/types";
import ChartFrame, { ChartError } from "./ChartFrame";
import type { LegendItem } from "./ChartFrame";
import ChartTooltip from "./ChartTooltip";
import { ALGORITHM_COLORS, BAR_RADIUS, INK, MAX_BAR, isFiniteNumber } from "./theme";

type MetricKey = "total_score" | "blocking_pairs" | "runtime_ms";

interface MetricSpec {
  key: MetricKey;
  title: string;
  description: string;
  format: (v: number) => string;
}

const countFmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

const SPECS: MetricSpec[] = [
  { key: "total_score", title: "Total score", description: "Higher is better", format: (v) => v.toFixed(2) },
  { key: "blocking_pairs", title: "Blocking pairs", description: "Lower is better; 0 is stable", format: countFmt },
  { key: "runtime_ms", title: "Runtime (ms)", description: "Lower is faster", format: (v) => v.toFixed(2) },
];

interface Entry {
  algorithm: AlgorithmName;
  label: string;
  value: number;
}

function problem(spec: MetricSpec, entries: Entry[]): string | null {
  for (const e of entries) {
    if (!isFiniteNumber(e.value)) return `${e.label} has a value that is not a finite number.`;
    if (e.value < 0) return `${e.label} has a negative value, which is not valid for ${spec.title.toLowerCase()}.`;
  }
  return null;
}

function MetricChart({ spec, entries }: { spec: MetricSpec; entries: Entry[] }) {
  const err = problem(spec, entries);
  if (err) return <ChartError title={spec.title} message={err} />;

  const summary = `${spec.title}, ${spec.description.toLowerCase()}. ${entries
    .map((e) => `${e.label} ${spec.format(e.value)}`)
    .join(", ")}.`;
  const legend: LegendItem[] = entries.map((e) => ({
    key: e.algorithm,
    label: e.label,
    color: ALGORITHM_COLORS[e.algorithm],
  }));
  const max = Math.max(...entries.map((e) => e.value));

  return (
    <ChartFrame
      title={spec.title}
      description={spec.description}
      summary={summary}
      legend={legend}
      table={{
        caption: `${spec.title} by algorithm`,
        headers: ["Algorithm", spec.title],
        rows: entries.map((e) => [e.label, spec.format(e.value)]),
      }}
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={entries} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={INK.grid} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: INK.axis }}
            tick={{ fill: INK.secondary, fontSize: 12 }}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            allowDecimals={spec.key !== "blocking_pairs"}
            domain={[0, max > 0 ? "auto" : 1]}
            tick={{ fill: INK.secondary, fontSize: 12 }}
            tickFormatter={(v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: INK.track, opacity: 0.6 }}
            content={(p) => {
              const first = p.payload?.[0]?.payload as Entry | undefined;
              if (!p.active || !first) return null;
              return (
                <ChartTooltip
                  rows={[
                    {
                      key: first.algorithm,
                      label: `${first.label}, ${spec.title.toLowerCase()}`,
                      value: spec.format(first.value),
                      color: ALGORITHM_COLORS[first.algorithm],
                    },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            maxBarSize={MAX_BAR}
            minPointSize={2}
            radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]}
            isAnimationActive={false}
          >
            {entries.map((e) => (
              <Cell key={e.algorithm} fill={ALGORITHM_COLORS[e.algorithm]} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              fill={INK.primary}
              fontSize={12}
              formatter={(v: unknown) => (isFiniteNumber(v) ? spec.format(v) : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Three small-multiple bar charts, each on its own axis (never a shared or dual
 * axis). One bar per algorithm present in `metrics`; a missing algorithm is simply
 * absent and the remaining one keeps its fixed colour.
 */
export default function ComparisonCharts({ metrics }: { metrics: RunMetrics }) {
  const present = ALGORITHM_NAMES.filter((a) => metrics[a] !== undefined);
  if (present.length === 0) {
    return <ChartError title="Algorithm comparison" message="No algorithm results are available for this run." />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {SPECS.map((spec) => {
        const entries: Entry[] = present.map((a) => ({
          algorithm: a,
          label: ALGORITHM_LABELS[a],
          value: (metrics[a] as AlgorithmMetrics)[spec.key],
        }));
        return <MetricChart key={spec.key} spec={spec} entries={entries} />;
      })}
    </div>
  );
}
