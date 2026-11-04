import { INK } from "./theme";

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color: string;
}

/**
 * Tooltip body. Values lead (strong), names follow (secondary); rows are keyed by a
 * short line of the series colour. All text is rendered as React text nodes.
 */
export default function ChartTooltip({
  title,
  rows,
}: {
  title?: string;
  rows: TooltipRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div
      className="viz-root max-w-64 rounded-md border px-3 py-2 text-sm shadow-md"
      style={{ borderColor: INK.axis, background: INK.surface }}
    >
      {title ? (
        <p className="m-0 mb-1 break-words font-medium" style={{ color: INK.secondary }}>
          {title}
        </p>
      ) : null}
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 shrink-0" style={{ background: r.color, height: 3 }} />
          <strong className="tabular-nums" style={{ color: INK.primary }}>
            {r.value}
          </strong>
          <span className="break-words" style={{ color: INK.secondary }}>
            {r.label}
          </span>
        </div>
      ))}
    </div>
  );
}
