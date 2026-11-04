import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRuns } from "../api/hooks";
import type { RunSummary } from "../api/types";
import { DataTable, type Column } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import { RunStatusBadge } from "../components/RunStatus";
import { StartRunForm } from "../components/StartRunForm";
import { errorMessage } from "../lib/errors";
import { formatTimestamp } from "../lib/format";
import { algorithmLabel } from "../lib/runs";

const PAGE = 25;

interface Row {
  rid: string;
  run: RunSummary;
}

function Time({ raw }: { raw: unknown }) {
  if (raw === null || raw === undefined) return <>—</>;
  const t = formatTimestamp(raw);
  return <time title={t.title}>{t.text}</time>;
}

const columns: Column<Row>[] = [
  {
    key: "id",
    header: "Run",
    render: (r) => (
      <Link className="underline" to={`/runs/${r.run.id}`} aria-label={`Run ${r.run.id}`}>
        {`Run ${r.run.id}`}
      </Link>
    ),
  },
  {
    key: "algorithm",
    header: "Algorithm",
    render: (r) => (typeof r.run.algorithm === "string" ? algorithmLabel(r.run.algorithm) : "unknown"),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => <RunStatusBadge status={r.run.status} />,
  },
  { key: "created", header: "Created", render: (r) => <Time raw={r.run.created_at} /> },
  { key: "finished", header: "Finished", render: (r) => <Time raw={r.run.finished_at} /> },
];

export default function Runs() {
  const [page, setPage] = useState(1);
  const q = useRuns({ limit: PAGE, offset: (page - 1) * PAGE });
  // The API already returns runs newest first; the id-desc sort is kept as defence for a stable order within a page.
  const rows = useMemo<Row[]>(
    () =>
      (q.data ?? [])
        .filter((r) => typeof r === "object" && r !== null && Number.isFinite(r.id))
        .map((run, i) => ({ rid: `${run.id}:${i}`, run }))
        .sort((a, b) => b.run.id - a.run.id),
    [q.data],
  );

  return (
    <section className="min-w-0 space-y-4">
      <h1 className="text-2xl font-semibold">Runs</h1>
      <StartRunForm />
      <h2 className="text-lg font-semibold">All runs</h2>
      {q.isPending ? (
        <p role="status">Loading...</p>
      ) : q.isError ? (
        <div role="alert" className="text-red-700">
          <p className="break-words">{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : page > 1 && q.data.length === 0 ? (
        <div>
          <p>No more runs.</p>
          <Pagination page={page} hasNext={false} onPageChange={setPage} />
        </div>
      ) : (
        <>
          <DataTable rows={rows} columns={columns} pageSize={PAGE} emptyMessage="No runs yet." getRowId={(r) => r.rid} />
          {(page > 1 || q.data.length >= PAGE) && (
            <Pagination page={page} hasNext={q.data.length >= PAGE} onPageChange={setPage} />
          )}
        </>
      )}
    </section>
  );
}
