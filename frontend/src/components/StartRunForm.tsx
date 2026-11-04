import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useStartRun } from "../api/hooks";
import type { RunAlgorithm } from "../api/types";
import { errorMessage } from "../lib/errors";

const OPTIONS: { value: RunAlgorithm; label: string }[] = [
  { value: "both", label: "Both (compare)" },
  { value: "hungarian", label: "Hungarian" },
  { value: "gale_shapley", label: "Gale-Shapley" },
];

export function StartRunForm() {
  const [algorithm, setAlgorithm] = useState<RunAlgorithm>("both");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const start = useStartRun();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await start.mutateAsync({ algorithm });
      void navigate(`/runs/${r.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded border border-slate-300 p-3">
      <h2 className="text-lg font-semibold">Start a run</h2>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Algorithm</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="algorithm"
              value={o.value}
              checked={algorithm === o.value}
              onChange={() => setAlgorithm(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded bg-slate-900 px-4 text-white disabled:opacity-60"
      >
        {busy ? "Starting..." : "Start run"}
      </button>
      <div aria-live="polite" role="status">
        {error && <p className="break-words text-red-700">{error}</p>}
      </div>
    </form>
  );
}
