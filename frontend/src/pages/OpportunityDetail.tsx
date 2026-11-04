import { errorMessage } from "../lib/errors";
import { Link, useParams } from "react-router-dom";
import { useOpportunity } from "../api/hooks";
import { SimilarCandidates } from "../components/SimilarCandidates";
import { educationLabel } from "../lib/validation";

export default function OpportunityDetail() {
  const raw = useParams().id ?? "";
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const q = useOpportunity(id);
  return (
    <section className="space-y-4">
      <Link to="/opportunities" className="underline">Back to opportunities</Link>
      {id === null ? (
        <p role="alert">Invalid opportunity id.</p>
      ) : q.isPending ? (
        <p>Loading...</p>
      ) : q.isError ? (
        <div role="alert" className="text-red-700">
          <p>{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <h1 className="break-words text-2xl font-semibold">{q.data.title}</h1>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Capacity</dt><dd>{q.data.capacity}</dd></div>
            <div><dt className="font-semibold">Min experience</dt><dd>{q.data.min_experience_years} years</dd></div>
            <div><dt className="font-semibold">Min education</dt><dd>{educationLabel(q.data.min_education_level)}</dd></div>
          </dl>
          <div>
            <h2 className="font-semibold">Required skills</h2>
            {q.data.required_skills.length === 0 ? (
              <p className="text-sm">None detected</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-2">
                {q.data.required_skills.map((s) => (
                  <li key={s} className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-sm" title={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="font-semibold">Posting</h2>
            <p className="mt-1 whitespace-pre-wrap break-words">{q.data.posting_text}</p>
          </div>
          <SimilarCandidates opportunityId={q.data.id} />
        </>
      )}
    </section>
  );
}
