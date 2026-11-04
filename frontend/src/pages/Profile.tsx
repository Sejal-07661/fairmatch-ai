import { Link } from "react-router-dom";
import { useMyCandidate } from "../api/hooks";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import ResumeForm from "../components/ResumeForm";
import { educationLabel } from "../lib/validation";

function CandidateProfile() {
  const q = useMyCandidate();
  let body;
  if (q.isPending) {
    body = <p aria-live="polite">Loading your profile…</p>;
  } else if (q.error instanceof ApiError && q.error.status === 404) {
    body = (
      <>
        <p className="mb-4">You have no profile yet. Add your resume to create one.</p>
        <ResumeForm onConflict={() => void q.refetch()} />
      </>
    );
  } else if (q.isError) {
    body = (
      <div role="alert">
        <p className="break-words text-red-700">{q.error instanceof ApiError ? q.error.detail : "Could not load your profile."}</p>
        <button type="button" className="mt-2 rounded border px-3 py-1" onClick={() => void q.refetch()}>
          Retry
        </button>
      </div>
    );
  } else {
    const c = q.data;
    body = (
      <section className="space-y-3">
        <h2 className="break-words text-xl font-medium">{c.name}</h2>
        {c.used_fallback && (
          <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
            Skills were extracted in basic mode (no AI model was available).
          </p>
        )}
        <ul className="flex flex-wrap gap-2" aria-label="Skills">
          {c.skills.map((s, i) => (
            <li key={`${i}-${s}`} className="min-w-0 max-w-full">
              <span title={s} className="block max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-sm">
                {s}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-medium">Experience</dt>
          <dd>{c.experience_years} years</dd>
          <dt className="font-medium">Education</dt>
          <dd>{educationLabel(c.education_level)}</dd>
        </dl>
      </section>
    );
  }
  return body;
}

export default function Profile() {
  const { user } = useAuth();
  return (
    <div className="min-w-0">
      <h1 className="mb-4 text-2xl font-semibold">Profile</h1>
      {user?.role === "admin" ? (
        <div className="space-y-2">
          <p>Admins manage candidates from the Candidates page</p>
          <Link to="/candidates" className="underline">
            Go to Candidates
          </Link>
        </div>
      ) : (
        <CandidateProfile />
      )}
    </div>
  );
}
