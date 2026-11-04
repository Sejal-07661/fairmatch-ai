// Task 6: import BreakdownBar, { DEFAULT_WEIGHTS } from "../components/charts/BreakdownBar";  (default + named)
import { useState } from "react";
import type { ScoreBreakdown } from "../../api/types";
import ChartFrame, { ChartError } from "./ChartFrame";
import type { LegendItem } from "./ChartFrame";
import ChartTooltip from "./ChartTooltip";
import { BREAKDOWN_COLORS, BREAKDOWN_PARTS, INK, SEGMENT_TEXT, SURFACE_GAP, isFiniteNumber, truncate } from "./theme";
import type { BreakdownPart } from "./theme";

/**
 * The API's default scoring weights (semantic, skill, experience, education). The
 * breakdown carries the RAW 0..1 signals, so a part's contribution to the total is
 * signal * weight. They sum to 1, so the contributions sum to `total`.
 */
export const DEFAULT_WEIGHTS: Record<BreakdownPart, number> = {
  semantic: 0.4,
  skill_overlap: 0.4,
  experience: 0.1,
  education: 0.1,
};

const LABELS: Record<BreakdownPart, string> = {
  semantic: "Semantic",
  skill_overlap: "Skills",
  experience: "Experience",
  education: "Education",
};

/** Beyond this gap between summed contributions and `total`, custom weights are assumed. */
const WEIGHT_TOLERANCE = 0.01;
/** A segment prints its value inline only when it is at least this share of the full bar. */
const LABEL_MIN_SHARE = 0.15;
const CHIP_CHARS = 32;

export interface Contribution {
  part: BreakdownPart;
  label: string;
  signal: number;
  weight: number;
  value: number;
}

export function contributions(b: ScoreBreakdown): Contribution[] {
  return BREAKDOWN_PARTS.map((part) => ({
    part,
    label: LABELS[part],
    signal: b[part],
    weight: DEFAULT_WEIGHTS[part],
    value: b[part] * DEFAULT_WEIGHTS[part],
  }));
}

function problem(b: ScoreBreakdown): string | null {
  for (const part of BREAKDOWN_PARTS) {
    const v = b[part];
    if (!isFiniteNumber(v)) return `${LABELS[part]} is not a finite number.`;
    if (v < 0 || v > 1) return `${LABELS[part]} is outside the expected range 0 to 1.`;
  }
  if (!isFiniteNumber(b.total) || b.total < 0) return "The total score is not a valid number.";
  return null;
}

const f2 = (v: number) => v.toFixed(2);

function Chips({ label, items }: { label: string; items: { text: string; full: string }[] }) {
  return (
    <div>
      <h4 className="m-0 mb-1 text-sm font-semibold" style={{ color: INK.primary }}>
        {label}
      </h4>
      {items.length === 0 ? (
        <p className="m-0 text-sm" style={{ color: INK.secondary }}>
          None
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {items.map((it, i) => (
            <li
              key={i}
              title={it.full}
              className="max-w-full break-all rounded-full border px-2.5 py-0.5 text-sm"
              style={{ borderColor: INK.axis, color: INK.primary }}
            >
              {it.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One tall segmented bar of weighted contributions to the score, drawn against a
 * track that represents the maximum score of 1. No numbers are rescaled: if the
 * contributions do not add up to `total`, a note says custom weights were used.
 */
export default function BreakdownBar({ breakdown }: { breakdown: ScoreBreakdown }) {
  const [active, setActive] = useState<number | null>(null);

  const err = problem(breakdown);
  if (err) return <ChartError title="Score breakdown" message={err} />;

  const parts = contributions(breakdown);
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const customWeights = Math.abs(sum - breakdown.total) > WEIGHT_TOLERANCE;
  const remaining = Math.max(0, 1 - sum);
  const legend: LegendItem[] = parts.map((p) => ({
    key: p.part,
    label: p.label,
    color: BREAKDOWN_COLORS[p.part],
  }));
  const activePart = active === null ? undefined : parts[active];
  const activeLeft = activePart
    ? parts.slice(0, active ?? 0).reduce((s, p) => s + p.value, 0) + activePart.value / 2
    : 0;

  const summary = `Score breakdown. ${parts
    .map((p) => `${p.label} ${f2(p.value)}`)
    .join(", ")}, total ${f2(breakdown.total)} out of 1.00.`;

  return (
    <div className="grid gap-3">
      <ChartFrame
        title="Score breakdown"
        description="Each part's contribution (signal times weight) to the match score"
        summary={summary}
        legend={legend}
        table={{
          caption: "Score breakdown by component",
          headers: ["Component", "Signal (0 to 1)", "Weight", "Contribution"],
          rows: [
            ...parts.map((p) => [p.label, f2(p.signal), String(p.weight), f2(p.value)]),
            ["Total", "", "", f2(breakdown.total)],
          ],
        }}
      >
        <div className="relative pt-1">
          <div
            className="flex h-7 items-stretch rounded-[4px]"
            style={{ gap: SURFACE_GAP, background: INK.track }}
          >
            {parts.map((p, i) =>
              p.value > 0 ? (
                <button
                  key={p.part}
                  type="button"
                  aria-label={`${p.label}: ${f2(p.value)} of 1.00`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((c) => (c === i ? null : c))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((c) => (c === i ? null : c))}
                  className="m-0 border-0 bg-transparent p-0"
                  style={{ flex: `${p.value} 1 0%`, minWidth: 8, margin: "-8px 0", padding: "8px 0", cursor: "default" }}
                >
                  <span
                    className="flex h-7 items-center justify-center whitespace-nowrap rounded-[4px] text-xs font-semibold"
                    style={{
                      display: "flex",
                      background: BREAKDOWN_COLORS[p.part],
                      color: SEGMENT_TEXT[p.part],
                      outline: active === i ? `2px solid ${INK.primary}` : "none",
                      outlineOffset: 1,
                    }}
                  >
                    {p.value >= LABEL_MIN_SHARE ? f2(p.value) : null}
                  </span>
                </button>
              ) : null,
            )}
            {remaining > 0 ? <div aria-hidden="true" style={{ flex: `${remaining} 1 0%` }} /> : null}
          </div>
          {activePart ? (
            <div
              role="tooltip"
              className="absolute z-10 -translate-x-1/2"
              style={{ left: `${Math.min(Math.max(activeLeft * 100, 18), 82)}%`, top: "100%", marginTop: 12 }}
            >
              <ChartTooltip
                rows={[
                  {
                    key: activePart.part,
                    label: `${activePart.label}, signal ${f2(activePart.signal)} x weight ${activePart.weight}`,
                    value: f2(activePart.value),
                    color: BREAKDOWN_COLORS[activePart.part],
                  },
                ]}
              />
            </div>
          ) : null}
          <div className="mt-1 flex justify-between text-xs tabular-nums" style={{ color: INK.secondary }}>
            <span>0</span>
            <span>1.00</span>
          </div>
        </div>
        <p className="m-0 mt-2 text-sm" style={{ color: INK.primary }}>
          Total score <strong className="tabular-nums">{f2(breakdown.total)}</strong>
        </p>
      </ChartFrame>
      {customWeights ? (
        <p role="note" className="m-0 mt-1 text-sm" style={{ color: INK.secondary }}>
          Note: custom weights were used, so these default-weight parts add up to {f2(sum)}, not the
          total of {f2(breakdown.total)}.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Chips
          label="Matched skills"
          items={breakdown.matched_skills.map((s) => ({ text: truncate(s, CHIP_CHARS), full: s }))}
        />
        <Chips
          label="Related skills"
          items={breakdown.related_skills.map(([a, b]) => ({
            text: `${truncate(a, CHIP_CHARS)} ~ ${truncate(b, CHIP_CHARS)}`,
            full: `${a} ~ ${b}`,
          }))}
        />
      </div>
    </div>
  );
}
