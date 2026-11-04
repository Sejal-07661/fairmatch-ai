import { useMemo, useState } from "react";
import type { Allocation, AlgorithmName, RunMetrics } from "../api/types";
import { ALGORITHM_LABELS } from "../api/types";
import { NAMES_FAILED_NOTE, NAMES_TRUNCATED_NOTE, presentAlgorithms, useNames } from "../lib/runs";
import { DataTable, type Column } from "./DataTable";

/**
 * AllocationTable({ allocations, metrics })
 *  - metrics: parsed RunMetrics, or undefined when it failed to parse (unallocated list is then unavailable)
 * Rows are one per allocation, ordered by opportunity, with seats used / capacity per opportunity.
 * Paginates at 25 through the shared DataTable.
 */
export interface AllocationTableProps {
  allocations: Allocation[];
  metrics: RunMetrics | undefined;
}

interface Row {
  rid: string;
  opportunityId: number;
  opportunity: string;
  seats: string;
  candidate: string;
  score: number | undefined;
}

const UNALLOCATED_CAP = 50;
const banner = "rounded border border-amber-600 bg-amber-50 p-2 text-sm text-slate-900";

const validAlloc = (a: unknown): a is Allocation =>
  typeof a === "object" &&
  a !== null &&
  Number.isFinite((a as Allocation).candidate_id) &&
  Number.isFinite((a as Allocation).opportunity_id);

export function AllocationTable({ allocations, metrics }: AllocationTableProps) {
  const names = useNames();
  const allocs = useMemo(() => (Array.isArray(allocations) ? allocations.filter(validAlloc) : []), [allocations]);
  const algos = useMemo(() => presentAlgorithms(allocs, metrics), [allocs, metrics]);
  const [chosen, setChosen] = useState<AlgorithmName | null>(null);
  const algo: AlgorithmName | null = chosen !== null && algos.includes(chosen) ? chosen : (algos[0] ?? null);

  const rows = useMemo<Row[]>(() => {
    const mine = algo === null ? allocs : allocs.filter((a) => a.algorithm === algo);
    const used = new Map<number, number>();
    for (const a of mine) used.set(a.opportunity_id, (used.get(a.opportunity_id) ?? 0) + 1);
    return mine
      .map((a, i) => ({
        rid: `${a.opportunity_id}:${a.candidate_id}:${i}`,
        opportunityId: a.opportunity_id,
        opportunity: names.opportunity(a.opportunity_id),
        seats: `${used.get(a.opportunity_id) ?? 0} / ${names.capacity(a.opportunity_id) ?? "?"}`,
        candidate: names.candidate(a.candidate_id),
        score: typeof a.score === "number" && Number.isFinite(a.score) ? a.score : undefined,
      }))
      .sort((x, y) => x.opportunityId - y.opportunityId || (y.score ?? -1) - (x.score ?? -1));
  }, [allocs, algo, names]);

  const columns: Column<Row>[] = [
    { key: "opportunity", header: "Opportunity", render: (r) => r.opportunity, sortValue: (r) => r.opportunity },
    { key: "seats", header: "Seats used / capacity", render: (r) => r.seats },
    { key: "candidate", header: "Candidate", render: (r) => r.candidate, sortValue: (r) => r.candidate },
    {
      key: "score",
      header: "Score",
      render: (r) => (r.score === undefined ? "n/a" : r.score.toFixed(3)),
      sortValue: (r) => r.score ?? Number.NaN,
    },
  ];

  const unallocated: number[] | undefined =
    metrics && algo ? metrics[algo]?.unallocated.filter((n) => Number.isFinite(n)) : undefined;

  return (
    <div className="space-y-4">
      {names.truncated && <p role="status" className={banner}>{NAMES_TRUNCATED_NOTE}</p>}
      {names.failed && <p role="status" className={banner}>{NAMES_FAILED_NOTE}</p>}
      {algos.length > 1 && (
        <fieldset className="flex flex-wrap gap-4" role="radiogroup" aria-label="Algorithm">
          <legend className="sr-only">Algorithm</legend>
          {algos.map((a) => (
            <label key={a} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="results-algorithm" checked={algo === a} onChange={() => setChosen(a)} />
              {ALGORITHM_LABELS[a]}
            </label>
          ))}
        </fieldset>
      )}
      <DataTable rows={rows} columns={columns} pageSize={25} getRowId={(r) => r.rid} emptyMessage="No allocations in this run." />
      <section aria-labelledby="unallocated-h" className="space-y-1">
        <h3 id="unallocated-h" className="font-semibold">Unallocated</h3>
        {metrics === undefined ? (
          <p className="text-sm">The unallocated list is unavailable because the run metrics could not be read.</p>
        ) : unallocated === undefined ? (
          <p className="text-sm">No unallocated data for this algorithm.</p>
        ) : unallocated.length === 0 ? (
          <p className="text-sm">Every candidate was allocated.</p>
        ) : (
          <>
            <ul aria-label="Unallocated" className="list-disc pl-5 text-sm">
              {unallocated.slice(0, UNALLOCATED_CAP).map((id, i) => {
                const label = names.candidate(id);
                return (
                  <li key={`${id}:${i}`} className="max-w-full truncate" title={label}>
                    {label}
                  </li>
                );
              })}
            </ul>
            {unallocated.length > UNALLOCATED_CAP && (
              <p className="text-sm">{`and ${unallocated.length - UNALLOCATED_CAP} more`}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
