// Task 6: import FairnessCharts from "../components/charts/FairnessCharts";  (default export; named: groupFairness, formatRatio, passesRule)
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALGORITHM_LABELS, ALGORITHM_NAMES } from "../../api/types";
import type { AlgorithmFairness, AlgorithmName, FairnessGroup, RunFairness } from "../../api/types";
import ChartFrame, { ChartError } from "./ChartFrame";
import type { LegendItem } from "./ChartFrame";
import ChartTooltip from "./ChartTooltip";
import StatusBadge from "./StatusBadge";
import { ALGORITHM_COLORS, BAR_RADIUS, INK, MAX_GROUPS, SURFACE_GAP, isFiniteNumber, truncate } from "./theme";

/** Four-fifths rule: a ratio of exactly 0.8 passes. */
export const FOUR_FIFTHS = 0.8;
const TICK_CHARS = 18;

/** Floor (never round up) to 3 decimals so a failing ratio such as 0.7955 cannot read "0.80". */
export function formatRatio(r: number): string {
  return (Math.floor(r * 1000 + 1e-9) / 1000).toFixed(3);
}

/** Pass/fail comes from the server flag; the ratio is only a fallback for a missing flag. */
export function passesRule(d: { passes_four_fifths?: unknown; disparate_impact_ratio: number }): boolean {
  return typeof d.passes_four_fifths === "boolean"
    ? d.passes_four_fifths
    : d.disparate_impact_ratio >= FOUR_FIFTHS - 1e-9;
}

/**
 * Keep at most MAX_GROUPS groups: when there are more, the 11 largest (by size) stay
 * in their original order and every other group is folded into one "Other" group
 * whose rate is recomputed from the summed counts (size-weighted mean score).
 */
export function groupFairness(groups: FairnessGroup[]): FairnessGroup[] {
  if (groups.length <= MAX_GROUPS) return groups;
  const keepCount = MAX_GROUPS - 1;
  const ranked = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.size - a.g.size || a.i - b.i);
  const keepIdx = new Set(ranked.slice(0, keepCount).map((r) => r.i));
  const kept = groups.filter((_, i) => keepIdx.has(i));
  const rest = groups.filter((_, i) => !keepIdx.has(i));
  const size = rest.reduce((s, g) => s + g.size, 0);
  const selected = rest.reduce((s, g) => s + g.selected, 0);
  const weighted = rest.reduce((s, g) => s + g.mean_score * g.size, 0);
  return [
    ...kept,
    {
      group: "Other",
      size,
      selected,
      selection_rate: size > 0 ? selected / size : 0,
      mean_score: size > 0 ? weighted / size : 0,
    },
  ];
}

function groupsProblem(a: AlgorithmFairness): string | null {
  if (!Array.isArray(a.groups) || a.groups.length === 0) return "No groups were reported.";
  for (const g of a.groups) {
    const name = truncate(g.group, 40);
    if (![g.size, g.selected, g.selection_rate, g.mean_score].every(isFiniteNumber)) {
      return `Group "${name}" has a value that is not a finite number.`;
    }
    if (g.size < 0 || g.selected < 0) return `Group "${name}" has a negative count.`;
    if (g.selection_rate < 0 || g.selection_rate > 1) {
      return `Group "${name}" has a selection rate outside 0 to 1.`;
    }
  }
  return null;
}

function ratioProblem(a: AlgorithmFairness): string | null {
  if (!isFiniteNumber(a.disparate_impact_ratio) || a.disparate_impact_ratio < 0) {
    return "The disparate impact ratio is not a valid number.";
  }
  if (!isFiniteNumber(a.parity_difference)) return "The parity difference is not a valid number.";
  return null;
}

interface Row {
  group: string;
  hungarian?: number;
  gale_shapley?: number;
  detail: Partial<Record<AlgorithmName, { size: number; selected: number }>>;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function buildRows(byAlgo: Partial<Record<AlgorithmName, FairnessGroup[]>>): Row[] {
  const rows = new Map<string, Row>();
  let hasOther = false;
  for (const a of ALGORITHM_NAMES) {
    for (const g of byAlgo[a] ?? []) {
      if (g.group === "Other") hasOther = true;
      const row = rows.get(g.group) ?? { group: g.group, detail: {} };
      row[a] = g.selection_rate;
      row.detail[a] = { size: g.size, selected: g.selected };
      rows.set(g.group, row);
    }
  }
  const list = Array.from(rows.values());
  return hasOther ? [...list.filter((r) => r.group !== "Other"), ...list.filter((r) => r.group === "Other")] : list;
}

interface TickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
}

function GroupTick({ x = 0, y = 0, payload }: TickProps) {
  const full = String(payload?.value ?? "");
  return (
    <text x={Number(x)} y={Number(y)} dy={4} textAnchor="end" fontSize={12} fill={INK.secondary}>
      <title>{full}</title>
      {truncate(full, TICK_CHARS)}
    </text>
  );
}

function SelectionRateChart({ byAlgo }: { byAlgo: Partial<Record<AlgorithmName, AlgorithmFairness>> }) {
  const present = ALGORITHM_NAMES.filter((a) => byAlgo[a] !== undefined);
  const bad = present
    .map((a) => ({ a, p: groupsProblem(byAlgo[a] as AlgorithmFairness) }))
    .find((x) => x.p !== null);
  if (bad) {
    return (
      <ChartError
        title="Selection rate by group"
        message={`${ALGORITHM_LABELS[bad.a]}: ${bad.p}`}
      />
    );
  }

  const grouped: Partial<Record<AlgorithmName, FairnessGroup[]>> = {};
  for (const a of present) grouped[a] = groupFairness((byAlgo[a] as AlgorithmFairness).groups);
  const rows = buildRows(grouped);
  const folded = present.some((a) => (byAlgo[a] as AlgorithmFairness).groups.length > MAX_GROUPS);
  const legend: LegendItem[] = present.map((a) => ({
    key: a,
    label: ALGORITHM_LABELS[a],
    color: ALGORITHM_COLORS[a],
  }));
  const allRates = rows.flatMap((r) => present.map((a) => r[a]).filter(isFiniteNumber));
  const maxRate = Math.max(...allRates, 0);

  const summary = `Selection rate by group. ${rows
    .map(
      (r) =>
        `${r.group}: ${present.map((a) => `${ALGORITHM_LABELS[a]} ${pct(r[a] ?? 0)}`).join(", ")}`,
    )
    .join("; ")}.`;

  const height = Math.max(160, rows.length * (present.length * 16 + 14) + 44);

  return (
    <ChartFrame
      title="Selection rate by group"
      description={
        folded
          ? `Share of each group selected. Showing the ${MAX_GROUPS - 1} largest groups; the rest are combined as "Other".`
          : "Share of each group that was selected"
      }
      summary={summary}
      legend={legend}
      table={{
        caption: "Selection rate by group and algorithm",
        headers: ["Group", "Algorithm", "Size", "Selected", "Selection rate"],
        rows: rows.flatMap((r) =>
          present.map((a) => [
            r.group,
            ALGORITHM_LABELS[a],
            String(r.detail[a]?.size ?? 0),
            String(r.detail[a]?.selected ?? 0),
            pct(r[a] ?? 0),
          ]),
        ),
      }}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={rows}
          layout="vertical"
          barGap={SURFACE_GAP}
          barCategoryGap={10}
          margin={{ top: 4, right: 40, bottom: 0, left: 0 }}
        >
          <CartesianGrid horizontal={false} stroke={INK.grid} strokeWidth={1} />
          <XAxis
            type="number"
            domain={[0, 1]}
            tickCount={5}
            tickLine={false}
            axisLine={{ stroke: INK.axis }}
            tick={{ fill: INK.secondary, fontSize: 12 }}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          <YAxis
            type="category"
            dataKey="group"
            width={120}
            interval={0}
            tickLine={false}
            axisLine={{ stroke: INK.axis }}
            tick={(p: TickProps) => <GroupTick {...p} />}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: INK.track, opacity: 0.6 }}
            content={(p) => {
              const row = p.payload?.[0]?.payload as Row | undefined;
              if (!p.active || !row) return null;
              return (
                <ChartTooltip
                  title={row.group}
                  rows={present.map((a) => ({
                    key: a,
                    label: `${ALGORITHM_LABELS[a]}, ${row.detail[a]?.selected ?? 0} of ${row.detail[a]?.size ?? 0} selected`,
                    value: pct(row[a] ?? 0),
                    color: ALGORITHM_COLORS[a],
                  }))}
                />
              );
            }}
          />
          {present.map((a) => (
            <Bar
              key={a}
              dataKey={a}
              fill={ALGORITHM_COLORS[a]}
              maxBarSize={14}
              radius={[0, BAR_RADIUS, BAR_RADIUS, 0]}
              isAnimationActive={false}
            >
              {/* Direct label on the highest bar only; the tooltip and table carry the rest. */}
              <LabelList
                dataKey={a}
                position="right"
                fill={INK.primary}
                fontSize={12}
                formatter={(v: unknown) => (isFiniteNumber(v) && v === maxRate && v > 0 ? pct(v) : "")}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function DisparatePanel({ algorithm, data }: { algorithm: AlgorithmName; data: AlgorithmFairness }) {
  const label = ALGORITHM_LABELS[algorithm];
  const err = ratioProblem(data);
  if (err) return <ChartError title={`Disparate impact: ${label}`} message={err} />;
  const ratio = data.disparate_impact_ratio;
  const passes = passesRule(data);
  const fill = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <div
      role="group"
      aria-label={`Disparate impact: ${label}`}
      className="min-w-0 rounded-lg border p-3"
      style={{ borderColor: INK.grid }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: INK.primary }}>
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: ALGORITHM_COLORS[algorithm] }}
          />
          {label}
        </h4>
        <StatusBadge
          status={passes ? "pass" : "fail"}
          label={passes ? "Passes four-fifths rule" : "Fails four-fifths rule"}
        />
      </div>
      <p className="m-0 mt-2 text-3xl font-semibold" style={{ color: INK.primary }}>
        {formatRatio(ratio)}
      </p>
      <p className="m-0 text-sm" style={{ color: INK.secondary }}>
        Disparate impact ratio
      </p>
      <div
        role="img"
        aria-label={`Disparate impact ratio ${formatRatio(ratio)}, threshold ${FOUR_FIFTHS}`}
        className="relative mt-6 h-2 rounded-full"
        style={{ background: INK.track }}
      >
        <div
          className="h-2 rounded-full"
          style={{ width: `${fill}%`, background: ALGORITHM_COLORS[algorithm] }}
        />
        <div
          aria-hidden="true"
          className="absolute -top-2 -bottom-2 w-px"
          style={{ left: `${FOUR_FIFTHS * 100}%`, background: INK.primary }}
        />
        <span
          aria-hidden="true"
          className="absolute -top-6 -translate-x-1/2 whitespace-nowrap text-xs"
          style={{ left: `${FOUR_FIFTHS * 100}%`, color: INK.secondary }}
        >
          {FOUR_FIFTHS} threshold
        </span>
      </div>
      <dl className="m-0 mt-3 flex items-baseline gap-2 text-sm">
        <dt style={{ color: INK.secondary }}>Parity difference</dt>
        <dd className="m-0 font-semibold tabular-nums" style={{ color: INK.primary }}>
          {isFiniteNumber(data.parity_difference) ? data.parity_difference.toFixed(2) : "n/a"}
        </dd>
      </dl>
    </div>
  );
}

/**
 * Fairness audit: grouped selection-rate bars per algorithm plus a disparate-impact
 * panel per algorithm. `fairness === null` means the audit was skipped.
 */
export default function FairnessCharts({
  fairness,
  skippedReason,
}: {
  fairness: RunFairness;
  skippedReason?: string;
}) {
  if (fairness === null) {
    return (
      <div
        className="viz-root rounded-lg border p-4 text-sm"
        style={{ borderColor: INK.axis, color: INK.secondary }}
      >
        <p className="m-0 font-medium" style={{ color: INK.primary }}>
          Fairness was not computed for this run.
        </p>
        {skippedReason ? <p className="m-0 mt-1">{skippedReason}</p> : null}
      </div>
    );
  }
  const present = ALGORITHM_NAMES.filter((a) => fairness[a] !== undefined);
  if (present.length === 0) {
    return <ChartError title="Fairness" message="No fairness results are available for this run." />;
  }
  const byAlgo: Partial<Record<AlgorithmName, AlgorithmFairness>> = {};
  for (const a of present) byAlgo[a] = fairness[a] as AlgorithmFairness;

  const diTable = present.map((a) => {
    const d = byAlgo[a] as AlgorithmFairness;
    const ok = isFiniteNumber(d.disparate_impact_ratio);
    return [
      ALGORITHM_LABELS[a],
      ok ? formatRatio(d.disparate_impact_ratio) : "invalid",
      String(FOUR_FIFTHS),
      ok ? (passesRule(d) ? "Passes" : "Fails") : "invalid",
      isFiniteNumber(d.parity_difference) ? d.parity_difference.toFixed(2) : "invalid",
    ];
  });

  return (
    <div className="grid gap-4">
      <SelectionRateChart byAlgo={byAlgo} />
      <ChartFrame
        title="Disparate impact"
        description="Lowest group selection rate divided by the highest; the server marks 0.8 or above as passing the four-fifths rule"
        summary={`Disparate impact. ${diTable
          .map((r) => `${r[0]}: ratio ${r[1]}, ${r[3]?.toLowerCase()} the 0.8 threshold, parity difference ${r[4]}`)
          .join("; ")}.`}
        table={{
          caption: "Disparate impact by algorithm",
          headers: ["Algorithm", "Ratio", "Threshold", "Four-fifths rule", "Parity difference"],
          rows: diTable,
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {present.map((a) => (
            <DisparatePanel key={a} algorithm={a} data={byAlgo[a] as AlgorithmFairness} />
          ))}
        </div>
      </ChartFrame>
    </div>
  );
}
