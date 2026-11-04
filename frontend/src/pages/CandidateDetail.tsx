import { errorMessage } from "../lib/errors";
import { Link, useParams } from "react-router-dom";
import { useCandidate } from "../api/hooks";
import { DemographicsEditor } from "../components/DemographicsEditor";
import { educationLabel } from "../lib/validation";

export default function CandidateDetail() {
  const raw = useParams().id ?? "";
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const q = useCandidate(id);
  return (
    <section className="space-y-4">
      <Link to="/candidates" className="underline">Back to candidates</Link>
      {id === null ? (
        <p role="alert">Invalid candidate id.</p>
      ) : q.isPending ? (
        <p>Loading...</p>
      ) : q.isError ? (
        <div role="alert" className="text-red-700">
          <p>{errorMessage(q.error)}</p>
          <button type="button" className="min-h-11 rounded border border-red-700 px-3" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : (
        <>
          <h1 className="break-words text-2xl font-semibold">{q.data.name}</h1>
          {q.data.used_fallback && (
            <p><span className="rounded bg-amber-100 px-2 py-0.5 text-sm">Basic mode</span></p>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="font-semibold">Experience</dt><dd>{q.data.experience_years} years</dd></div>
            <div><dt className="font-semibold">Education</dt><dd>{educationLabel(q.data.education_level)}</dd></div>
          </dl>
          <div>
            <h2 className="font-semibold">Skills</h2>
            {q.data.skills.length === 0 ? (
              <p className="text-sm">None detected</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-2">
                {q.data.skills.map((s) => (
                  <li key={s} className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-sm" title={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
          <DemographicsEditor candidateId={q.data.id} />
        </>
      )}
    </section>
  );
}
