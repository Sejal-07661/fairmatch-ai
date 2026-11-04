import { errorMessage } from "../lib/errors";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useDemographics, useSetDemographics } from "../api/hooks";

export function DemographicsEditor({ candidateId }: { candidateId: number }) {
  const query = useDemographics(candidateId);
  const save = useSetDemographics();
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const current = query.data?.group_label;

  const label = edited ?? current ?? "";
  const setLabel = setEdited;

  const notSet = query.error instanceof ApiError && query.error.status === 404;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const v = label.trim();
    if (v.length < 1 || v.length > 64) return setError("Group label must be 1 to 64 characters.");
    if (v.includes("\u0000")) return setError("Group label must not contain NUL characters.");
    setError("");
    save.mutate(
      { candidateId, group_label: v },
      { onSuccess: () => setSaved(true), onError: (err) => setError(err.message) },
    );
  };

  return (
    <section aria-labelledby="demo-h" className="rounded border border-slate-200 p-3">
      <h2 id="demo-h" className="text-lg font-semibold">Demographic group</h2>
      <p className="mt-1 text-sm text-slate-700">
        This label is used only for the fairness audit and never for scoring.
      </p>
      <p className="mt-2 text-sm">
        Current:{" "}
        {query.isPending ? "Loading..." : notSet ? <strong>Not set</strong> : query.isError ? (
          <span role="alert" className="text-red-700">{errorMessage(query.error)}</span>
        ) : (
          <strong>{current}</strong>
        )}
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-2 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="demo-label">Group label</label>
          <input id="demo-label" className="mt-1 w-full rounded border border-slate-300 px-2 py-2" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button type="submit" disabled={save.isPending} className="min-h-11 rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          Save
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <p aria-live="polite" className="mt-2 text-sm text-green-800">{saved ? "Saved." : ""}</p>
    </section>
  );
}
