import { useMemo, useState } from "react";
import { useExplanations } from "../api/hooks";
import { parseScoreBreakdown, type Allocation, type Explanation } from "../api/types";
import { errorMessage } from "../lib/errors";
import { algorithmLabel, allocKey, useNames } from "../lib/runs";
import BreakdownBar from "./charts/BreakdownBar";
import { DataTable, type Column } from "./DataTable";

/**
 * ExplanationPanel({ runId, allocations })
 * Explanations are joined to allocations by `${algorithm}:${candidate_id}`. Selecting an allocation shows
 * reasons, narrative, a template notice and the score breakdown (taken from the allocation).
 * All text is rendered as plain text and clamped, with the full text in `title` and an expand control.
 */
export interface ExplanationPanelProps {
  runId: number;
  allocations: Allocation[];
}

const CLAMP = 280;

function ClampedText({ text, testId }: { text: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP;
  const shown = long && !open ? `${text.slice(0, CLAMP)}…` : text;
  return (
    <div className="min-w-0">
      <p data-testid={testId} title={text} className="break-words whitespace-pre-wrap">
        {shown}
      </p>
      {long && (
        <button
          type="button"
          className="min-h-11 text-sm underline"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Show less" : "Show full text"}
        </button>
      )}
    </div>
  );
}

interface Row {
  rid: string;
  key: string;
  algorithm: string;
  candidate: string;
  opportunity: string;
  score: number | undefined;
}

const isStr = (x: unknown): x is string => typeof x === "string";

function indexExplanations(data: unknown): Map<string, Explanation> {
  const m = new Map<string, Explanation>();
  if (!Array.isArray(data)) return m;
  for (const e of data as unknown[]) {
    if (typeof e !== "object" || e === null) continue;
    const x = e as Partial<Explanation>;
    if (!isStr(x.algorithm) || typeof x.candidate_id !== "number") continue;
    const k = allocKey(x.algorithm, x.candidate_id);
    if (!m.has(k)) m.set(k, x as Explanation);
  }
  return m;
}

export function ExplanationPanel({ runId, allocations }: ExplanationPanelProps) {
  const names = useNames();
  const q = useExplanations(runId);
  const [selected, setSelected] = useState<string | null>(null);

  const allocs = useMemo(
    () =>
      (Array.isArray(allocations) ? allocations : []).filter(
        (a) => typeof a === "object" && a !== null && Number.isFinite(a.candidate_id) && isStr(a.algorithm),
      ),
    [allocations],
  );
  const byKey = useMemo(() => indexExplanations(q.data), [q.data]);
  const rows = useMemo<Row[]>(
    () =>
      allocs.map((a, i) => ({
        rid: `${allocKey(a.algorithm, a.candidate_id)}:${i}`,
        key: allocKey(a.algorithm, a.candidate_id),
        algorithm: a.algorithm,
        candidate: names.candidate(a.candidate_id),
        opportunity: names.opportunity(a.opportunity_id),
        score: typeof a.score === "number" && Number.isFinite(a.score) ? a.score : undefined,
      })),
    [allocs, names],
  );

  const columns: Column<Row>[] = [
    { key: "algorithm", header: "Algorithm", render: (r) => algorithmLabel(r.algorithm), sortValue: (r) => r.algorithm },
    { key: "candidate", header: "Candidate", render: (r) => r.candidate, sortValue: (r) => r.candidate },
    { key: "opportunity", header: "Opportunity", render: (r) => r.opportunity, sortValue: (r) => r.opportunity },
    { key: "score", header: "Score", render: (r) => (r.score === undefined ? "n/a" : r.score.toFixed(3)) },
    {
      key: "action",
      header: "Explanation",
      render: (r) => (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-400 px-3 text-sm"
          aria-pressed={selected === r.key}
          aria-label={`Explain ${r.candidate} (${algorithmLabel(r.algorithm)})`}
          onClick={() => setSelected(r.key)}
        >
          Explain
        </button>
      ),
    },
  ];

  const selectedAlloc = selected === null ? undefined : allocs.find((a) => allocKey(a.algorithm, a.candidate_id) === selected);
  const expl = selected === null ? undefined : byKey.get(selected);

  return (
    <div className="space-y-4">
      {q.isError && (
        <div role="alert" className="text-red-700">
          <p className="break-words">{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      )}
      {q.isPending && <p role="status">Loading explanations...</p>}
      {allocs.length === 0 ? (
        <p>No allocations to explain.</p>
      ) : (
        <DataTable rows={rows} columns={columns} pageSize={25} getRowId={(r) => r.rid} emptyMessage="No allocations to explain." />
      )}
      {selectedAlloc && <Detail alloc={selectedAlloc} expl={expl} loading={q.isPending} />}
    </div>
  );
}

function Detail({ alloc, expl, loading }: { alloc: Allocation; expl: Explanation | undefined; loading: boolean }) {
  const src = expl ?? alloc;
  const reasons = Array.isArray(src.reasons) ? src.reasons.filter(isStr) : [];
  const narrative = isStr(src.narrative) ? src.narrative : "";
  const fallback = src.used_fallback === true;
  const breakdown = parseScoreBreakdown(alloc.breakdown);
  return (
    <section aria-label="Explanation" className="min-w-0 space-y-3 rounded border border-slate-300 p-3">
      <h3 className="font-semibold">Explanation</h3>
      {!expl && !loading && (
        <p role="status" className="text-sm">
          No separate explanation record was found for this match; showing the text stored with the allocation.
        </p>
      )}
      {fallback && (
        <p className="rounded border border-slate-400 bg-slate-50 p-2 text-sm">Template explanation (no AI model used)</p>
      )}
      {reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {reasons.map((r, i) => (
            <li key={i} className="break-words">
              <ClampedText text={r} />
            </li>
          ))}
        </ul>
      )}
      {narrative !== "" && <ClampedText text={narrative} testId="narrative" />}
      {breakdown.ok ? (
        <BreakdownBar breakdown={breakdown.data} />
      ) : (
        <p role="alert" className="text-red-700">{`Score breakdown unavailable: ${breakdown.error}`}</p>
      )}
    </section>
  );
}
