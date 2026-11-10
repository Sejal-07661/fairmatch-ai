import { formatElapsed, formatTimestamp, parseApiDate } from "../lib/format";
import { algorithmLabel } from "../lib/runs";
import type { Run } from "../api/types";

export const AUDIT_NOTE =
  "This record contains the run id, algorithm, status, the admin who started it, its created, started and finished times, any error, and the fairness-skipped reason. It does not record scoring weights, input snapshots or later edits to candidates or opportunities.";

function Time({ raw }: { raw: unknown }) {
  if (raw === null || raw === undefined) return <>Not yet</>;
  const t = formatTimestamp(raw);
  return <time title={t.title}>{t.text}</time>;
}

function duration(run: Pick<Run, "started_at" | "finished_at">): string {
  const s = parseApiDate(run.started_at);
  const f = parseApiDate(run.finished_at);
  if (!s || !f) return "Not available";
  return formatElapsed(f.getTime() - s.getTime());
}

export function AuditTrail({ run, skippedReason }: { run: Run; skippedReason?: string | undefined }) {
  const email = typeof run.requested_by_email === "string" && run.requested_by_email !== "" ? run.requested_by_email : null;
  return (
    <section aria-labelledby="audit-heading" className="space-y-2 rounded border border-slate-300 p-3">
      <h2 id="audit-heading" className="text-lg font-semibold">Audit trail</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Run id</dt>
        <dd>{run.id}</dd>
        <dt className="font-medium">Algorithm</dt>
        <dd>{algorithmLabel(String(run.algorithm))}</dd>
        <dt className="font-medium">Status</dt>
        <dd>{String(run.status)}</dd>
        <dt className="font-medium">Started by</dt>
        <dd className="break-all">{email ?? "Unknown (user no longer exists)"}</dd>
        <dt className="font-medium">Created</dt>
        <dd><Time raw={run.created_at} /></dd>
        <dt className="font-medium">Started</dt>
        <dd><Time raw={run.started_at} /></dd>
        <dt className="font-medium">Finished</dt>
        <dd><Time raw={run.finished_at} /></dd>
        <dt className="font-medium">Duration</dt>
        <dd>{duration(run)}</dd>
        {run.error ? (
          <>
            <dt className="font-medium">Error</dt>
            <dd className="break-words">{run.error}</dd>
          </>
        ) : null}
        {skippedReason ? (
          <>
            <dt className="font-medium">Fairness skipped</dt>
            <dd className="break-words">{skippedReason}</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs text-slate-700">{AUDIT_NOTE}</p>
    </section>
  );
}
