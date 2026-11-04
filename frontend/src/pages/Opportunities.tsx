import { errorMessage } from "../lib/errors";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useOpportunities } from "../api/hooks";
import { DataTable } from "../components/DataTable";
import { OpportunityForm } from "../components/OpportunityForm";
import { Pagination } from "../components/Pagination";
import { educationLabel } from "../lib/validation";

const PAGE = 25;

export default function Opportunities() {
  const [page, setPage] = useState(1);
  const q = useOpportunities({ limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Opportunities</h1>
      <OpportunityForm />
      {q.isPending ? (
        <p>Loading...</p>
      ) : q.isError ? (
        <div role="alert" className="text-red-700">
          <p>{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : page > 1 && q.data.length === 0 ? (
        <div>
          <p>No more opportunities.</p>
          <Pagination page={page} hasNext={false} onPageChange={setPage} />
        </div>
      ) : (
        <>
          <DataTable
            rows={q.data}
            pageSize={PAGE}
            emptyMessage="No opportunities yet. Create one above."
            getRowId={(o) => o.id}
            columns={[
              { key: "title", header: "Title", render: (o) => o.title, sortValue: (o) => o.title },
              { key: "capacity", header: "Capacity", render: (o) => o.capacity, sortValue: (o) => o.capacity },
              { key: "exp", header: "Min experience", render: (o) => `${o.min_experience_years} yrs`, sortValue: (o) => o.min_experience_years },
              { key: "edu", header: "Min education", render: (o) => educationLabel(o.min_education_level), sortValue: (o) => o.min_education_level },
              { key: "link", header: "Details", render: (o) => <Link className="underline" to={`/opportunities/${o.id}`} aria-label={`View ${o.title}`}>View</Link> },
            ]}
          />
          {(page > 1 || q.data.length >= PAGE) && <Pagination page={page} hasNext={q.data.length >= PAGE} onPageChange={setPage} />}
        </>
      )}
    </section>
  );
}
