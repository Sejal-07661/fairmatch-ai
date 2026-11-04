import { errorMessage } from "../lib/errors";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCandidates } from "../api/hooks";
import { DataTable } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import { educationLabel } from "../lib/validation";

const PAGE = 25;

export default function Candidates() {
  const [page, setPage] = useState(1);
  const q = useCandidates({ limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Candidates</h1>
      {q.isPending ? (
        <p>Loading...</p>
      ) : q.isError ? (
        <div role="alert" className="text-red-700">
          <p>{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : page > 1 && q.data.length === 0 ? (
        <div>
          <p>No more candidates.</p>
          <Pagination page={page} hasNext={false} onPageChange={setPage} />
        </div>
      ) : (
        <>
          <DataTable
            rows={q.data}
            pageSize={PAGE}
            emptyMessage="No candidates yet."
            getRowId={(c) => c.id}
            columns={[
              { key: "name", header: "Name", render: (c) => c.name, sortValue: (c) => c.name },
              { key: "skills", header: "Skills", render: (c) => c.skills.length, sortValue: (c) => c.skills.length },
              { key: "exp", header: "Experience", render: (c) => `${c.experience_years} yrs`, sortValue: (c) => c.experience_years },
              { key: "edu", header: "Education", render: (c) => educationLabel(c.education_level), sortValue: (c) => c.education_level },
              { key: "mode", header: "Mode", render: (c) => (c.used_fallback ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs">Basic mode</span> : "Standard") },
              { key: "link", header: "Details", render: (c) => <Link className="underline" to={`/candidates/${c.id}`} aria-label={`View ${c.name}`}>View</Link> },
            ]}
          />
          {(page > 1 || q.data.length >= PAGE) && <Pagination page={page} hasNext={q.data.length >= PAGE} onPageChange={setPage} />}
        </>
      )}
    </section>
  );
}
