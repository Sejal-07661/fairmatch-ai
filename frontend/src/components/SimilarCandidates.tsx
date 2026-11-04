import { errorMessage } from "../lib/errors";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAllCandidates, useSimilar } from "../api/hooks";

const LIMITS = [5, 10, 25, 50];

export function SimilarCandidates({ opportunityId }: { opportunityId: number }) {
  const [limit, setLimit] = useState(10);
  const sim = useSimilar(opportunityId, limit);
  const cands = useAllCandidates();
  const names = useMemo(() => new Map((cands.data ?? []).map((c) => [c.id, c.name])), [cands.data]);

  return (
    <section aria-labelledby="sim-h" className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sim-h" className="text-lg font-semibold">Similar candidates</h2>
        <label className="text-sm">
          Show top{" "}
          <select className="ml-1 rounded border border-slate-300 px-2 py-1" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {cands.truncated && <p role="status" className="mt-2 text-sm text-amber-800">Candidate names are incomplete (list truncated).</p>}
      {sim.isPending ? (
        <p className="mt-2 text-sm">Loading...</p>
      ) : sim.isError ? (
        <div role="alert" className="mt-2 text-sm text-red-700">
          <p>{errorMessage(sim.error)}</p>
          <button type="button" className="mt-1 min-h-11 rounded border border-red-700 px-3" onClick={() => void sim.refetch()}>
            Retry
          </button>
        </div>
      ) : sim.data.length === 0 ? (
        <p className="mt-2 text-sm">No embeddings yet</p>
      ) : (
        <ol className="mt-2 divide-y divide-slate-200">
          {sim.data.map((s) => (
            <li key={s.candidate_id} className="flex justify-between gap-2 py-2 text-sm">
              <Link className="min-w-0 truncate underline" to={`/candidates/${s.candidate_id}`} title={names.get(s.candidate_id) ?? `Candidate #${s.candidate_id}`}>
                {names.get(s.candidate_id) ?? `Candidate #${s.candidate_id}`}
              </Link>
              <span>{(s.similarity * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
