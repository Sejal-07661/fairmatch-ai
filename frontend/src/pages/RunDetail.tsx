import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useRun } from "../api/hooks";
import { ApiError } from "../api/client";
import { ALGORITHM_LABELS, ALGORITHM_NAMES, type RunFairness, type RunMetrics } from "../api/types";
import type { ParseResult } from "../api/types";
import { AuditTrail } from "../components/AuditTrail";
import { AllocationTable } from "../components/AllocationTable";
import ComparisonCharts from "../components/charts/ComparisonCharts";
import FairnessCharts from "../components/charts/FairnessCharts";
import { ExplanationPanel } from "../components/ExplanationPanel";
import { RunStatus, normalizeStatus } from "../components/RunStatus";
import { errorMessage } from "../lib/errors";
import { parseApiDate } from "../lib/format";

const TABS = [
  { id: "results", label: "Results" },
  { id: "comparison", label: "Comparison" },
  { id: "fairness", label: "Fairness" },
  { id: "explanations", label: "Explanations" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Tabs({ panels }: { panels: Record<TabId, ReactNode> }) {
  const [active, setActive] = useState<TabId>("results");
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  function onKeyDown(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === active);
    const targets: Record<string, number> = {
      ArrowRight: (i + 1) % TABS.length,
      ArrowLeft: (i - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const next = targets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[next];
    if (!t) return;
    setActive(t.id);
    refs.current[t.id]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Run results" onKeyDown={onKeyDown} className="flex flex-wrap gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={active === t.id ? `panel-${t.id}` : undefined}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            className={`min-h-11 px-3 text-sm font-medium ${active === t.id ? "border-b-2 border-slate-900" : "text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="mt-4 min-w-0">
        <h2 className="mb-3 text-lg font-semibold">{TABS.find((t) => t.id === active)?.label}</h2>
        {panels[active]}
      </div>
    </div>
  );
}

function Comparison({ metrics }: { metrics: ParseResult<RunMetrics> }) {
  if (!metrics.ok) return <p>Comparison is unavailable because the run metrics could not be read.</p>;
  const present = ALGORITHM_NAMES.filter((a) => metrics.data[a] !== undefined);
  if (present.length === 2) return <ComparisonCharts metrics={metrics.data} />;
  const only = present[0];
  const m = only ? metrics.data[only] : undefined;
  if (!only || !m) return <p>No algorithm results are available for this run.</p>;
  return (
    <div className="space-y-2">
      <p>{`Only ${ALGORITHM_LABELS[only]} ran, so there is nothing to compare.`}</p>
      <dl className="grid max-w-sm grid-cols-2 gap-1 text-sm">
        <dt>Total score</dt>
        <dd>{m.total_score.toFixed(2)}</dd>
        <dt>Blocking pairs</dt>
        <dd>{String(m.blocking_pairs)}</dd>
        <dt>Runtime (ms)</dt>
        <dd>{m.runtime_ms.toFixed(2)}</dd>
        <dt>Unallocated</dt>
        <dd>{m.unallocated.length}</dd>
      </dl>
    </div>
  );
}

function Fairness({ fairness, metrics }: { fairness: ParseResult<RunFairness>; metrics: ParseResult<RunMetrics> }) {
  if (!fairness.ok) return <p role="alert" className="text-red-700">{fairness.error}</p>;
  return <FairnessCharts fairness={fairness.data} skippedReason={metrics.ok ? metrics.data.fairness_skipped : undefined} />;
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
      <Link className="underline" to="/runs">Back to runs</Link>
    </section>
  );
}

export default function RunDetail() {
  const { id } = useParams();
  const runId = id !== undefined && /^[1-9]\d{0,9}$/.test(id) ? Number(id) : null;
  const q = useRun(runId);

  if (runId === null || (q.error instanceof ApiError && q.error.status === 404)) {
    return <Message title="Run not found"><p>That run does not exist.</p></Message>;
  }
  if (q.isPending) return <p role="status">Loading run...</p>;
  const run = q.data;
  if (!run || !q.parsed) {
    return (
      <Message title="Run unavailable">
        <div role="alert" className="text-red-700">
          <p className="break-words">{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      </Message>
    );
  }

  const status = normalizeStatus(run.status);
  const { metrics, fairness } = q.parsed;
  const created = parseApiDate(run.created_at);

  return (
    <section className="min-w-0 space-y-4">
      <h1 className="text-2xl font-semibold">{`Run #${run.id}`}</h1>
      <RunStatus
        run={run}
        waitingSince={created ? created.getTime() : null}
        onRefresh={() => void q.refetch()}
        refreshing={q.isFetching}
      />
      <AuditTrail run={run} skippedReason={metrics.ok ? metrics.data.fairness_skipped : undefined} />
      {q.isError && (
        <p role="alert" className="break-words text-red-700">{`Could not refresh this run: ${errorMessage(q.error)}`}</p>
      )}
      {(status === "pending" || status === "running") && <p>Results will appear here when the run finishes.</p>}
      {status === "failed" && <p>No results are available for a failed run.</p>}
      {status === "unknown" && <p>This run has an unrecognised status, so its results are not shown.</p>}
      {status === "done" && (
        <>
          {!metrics.ok && (
            <p role="alert" className="break-words rounded border border-red-700 bg-red-50 p-2 text-sm">
              {`Run metrics could not be read (${metrics.error}). Allocations and explanations are still shown.`}
            </p>
          )}
          <Tabs
            panels={{
              results: <AllocationTable allocations={run.allocations ?? []} metrics={metrics.ok ? metrics.data : undefined} />,
              comparison: <Comparison metrics={metrics} />,
              fairness: <Fairness fairness={fairness} metrics={metrics} />,
              explanations: <ExplanationPanel runId={run.id} allocations={run.allocations ?? []} />,
            }}
          />
        </>
      )}
    </section>
  );
}
