/**
 * Task 6 usage:
 *   import ChartFrame, { ChartError, Legend } from "../components/charts/ChartFrame";
 * Interface decisions (deviate from the plan's bare {title, description, table, children}):
 *  - `summary` (string) is REQUIRED: it is the aria-label of the chart image.
 *  - `legend` is optional; it is drawn only for two or more items.
 *  - `table` is {caption?, headers: string[], rows: string[][]} (strings only).
 *  - Colours from theme.ts (ALGORITHM_COLORS, BREAKDOWN_COLORS, INK) are CSS var()
 *    strings, not hex; raw hexes live in ALGORITHM_PALETTE / BREAKDOWN_PALETTE / INK_PALETTE.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import "./charts.css";
import { INK } from "./theme";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
}

export interface TableData {
  caption?: string;
  headers: string[];
  rows: string[][];
}

interface Props {
  title: string;
  description?: string;
  /** Screen-reader summary of the chart (used as the aria-label of the chart image). */
  summary: string;
  /** The same data as the chart, shown by the Table toggle. */
  table: TableData;
  /** A legend is drawn only when two or more items are given. */
  legend?: LegendItem[];
  children: ReactNode;
}

type View = "chart" | "table";

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul aria-label="Legend" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm" style={{ color: INK.secondary }}>
      {items.map((it) => (
        <li key={it.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            data-testid={`legend-swatch-${it.key}`}
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: it.color }}
          />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChartError({ title, message }: { title: string; message: string }) {
  return (
    <div
      role="alert"
      className="viz-root rounded-lg border p-4 text-sm"
      style={{ borderColor: INK.axis }}
    >
      <p className="m-0 font-medium" style={{ color: INK.primary }}>
        {title}: chart cannot be shown
      </p>
      <p className="m-0 mt-1" style={{ color: INK.secondary }}>
        {message}
      </p>
    </div>
  );
}

export default function ChartFrame({ title, description, summary, table, legend, children }: Props) {
  const [view, setView] = useState<View>("chart");
  const [announcement, setAnnouncement] = useState("");
  const headingId = useId();

  function choose(next: View) {
    setView(next);
    setAnnouncement(`Showing ${next} view of ${title}`);
  }

  const btn = (v: View, label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => choose(v)}
      className="min-h-8 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        borderColor: INK.axis,
        color: INK.primary,
        background: view === v ? INK.track : "transparent",
        fontWeight: view === v ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <figure
      className="viz-root m-0 min-w-0 rounded-xl border p-4"
      style={{ borderColor: INK.grid }}
      aria-labelledby={headingId}
    >
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="m-0 text-base font-semibold" style={{ color: INK.primary }}>
            {title}
          </h3>
          {description ? (
            <p className="m-0 text-sm" style={{ color: INK.secondary }}>
              {description}
            </p>
          ) : null}
        </div>
        <div role="group" aria-label={`View for ${title}`} className="flex gap-1">
          {btn("chart", "Chart")}
          {btn("table", "Table")}
        </div>
      </figcaption>
      {legend ? <Legend items={legend} /> : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {view === "chart" ? (
        <div role="img" aria-label={summary} className="mt-2 min-w-0">
          {children}
        </div>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ color: INK.primary }}>
            {table.caption ? <caption className="sr-only">{table.caption}</caption> : null}
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-b px-2 py-1 text-left font-semibold"
                    style={{ borderColor: INK.axis, color: INK.secondary }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="max-w-64 break-words border-b px-2 py-1 tabular-nums"
                      style={{ borderColor: INK.grid }}
                      title={cell}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
