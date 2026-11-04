import { useEffect, useState } from "react";
import { formatElapsed } from "../lib/format";

/**
 * RunStatus({ run, waitingSince, onRefresh?, refreshing? })
 *  - waitingSince: epoch ms (or Date) the run started waiting; null/NaN hides the elapsed time
 *  - badge = icon + text for every status (never colour alone); a polite live region announces status
 */
export interface RunStatusProps {
  run: { id: number; status: string; error: string | null };
  waitingSince: number | Date | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const STUCK_AFTER_MS = 60_000;
export const STUCK_NOTE =
  "This run is taking longer than usual; it may be stuck. Runs interrupted by a server restart are not recovered automatically.";

type Known = "pending" | "running" | "done" | "failed";
const LABEL: Record<Known | "unknown", string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
  unknown: "Unknown",
};
const STYLE: Record<Known | "unknown", string> = {
  pending: "border-slate-500 bg-slate-50",
  running: "border-blue-700 bg-blue-50",
  done: "border-green-700 bg-green-50",
  failed: "border-red-700 bg-red-50",
  unknown: "border-slate-500 bg-slate-50",
};
const ICON: Record<Known | "unknown", string> = {
  pending: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 4h-2v6l4.5 2.7 1-1.6-3.5-2.1z",
  running: "M12 4V1L8 5l4 4V6a6 6 0 0 1 0 12 6 6 0 0 1-5.6-8.2L5 9a8 8 0 1 0 7-5z",
  done: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1.2 13.2-3.6-3.6 1.4-1.4 2.2 2.2 4.6-4.6 1.4 1.4-6 6z",
  failed: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.7 11.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3-2.3-2.3 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3z",
  unknown: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1 13h2v2h-2zm1-9a3 3 0 0 1 1 5.8V14h-2v-2h1a1 1 0 1 0-1-1H10a3 3 0 0 1 2-4z",
};

export function normalizeStatus(s: unknown): Known | "unknown" {
  return s === "pending" || s === "running" || s === "done" || s === "failed" ? s : "unknown";
}

export function RunStatusBadge({ status: raw }: { status: unknown }) {
  const status = normalizeStatus(raw);
  return (
    <span
      data-testid="run-status-badge"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium text-slate-900 ${STYLE[status]}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={ICON[status]} fill="currentColor" />
      </svg>
      <span>{LABEL[status]}</span>
    </span>
  );
}

export function RunStatus({ run, waitingSince, onRefresh, refreshing }: RunStatusProps) {
  const status = normalizeStatus(run.status);
  const active = status === "pending" || status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const since = waitingSince instanceof Date ? waitingSince.getTime() : waitingSince;
  const elapsed = active && since !== null && Number.isFinite(since) ? Math.max(0, now - since) : null;
  const stuck = elapsed !== null && elapsed > STUCK_AFTER_MS;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <RunStatusBadge status={run.status} />
        {elapsed !== null && <span className="text-sm text-slate-700">Waiting {formatElapsed(elapsed)}</span>}
        {onRefresh && (
          <button
            type="button"
            className="min-h-11 rounded border border-slate-400 px-3 text-sm disabled:opacity-50"
            onClick={onRefresh}
            disabled={refreshing}
          >
            Refresh
          </button>
        )}
      </div>
      <p aria-live="polite" role="status" className="sr-only">{`Run ${run.id} status: ${LABEL[status]}`}</p>
      {stuck && (
        <p role="status" className="rounded border border-amber-600 bg-amber-50 p-2 text-sm text-slate-900">{STUCK_NOTE}</p>
      )}
      {status === "failed" && (
        <p role="alert" className="break-words rounded border border-red-700 bg-red-50 p-2 text-sm text-slate-900">
          {run.error && run.error.trim() !== "" ? run.error : "The run failed without an error message."}
        </p>
      )}
    </div>
  );
}
