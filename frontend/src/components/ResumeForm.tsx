import { useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useCreateCandidate } from "../api/hooks";
import { MAX_TEXT, validateResumeInput } from "../lib/validation";

export default function ResumeForm({ onConflict }: { onConflict: () => void }) {
  const create = useCreateCandidate();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const problem = validateResumeInput({ name, text, file });
  const touched = name !== "" || text !== "" || file !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || problem !== null) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.append("name", name.trim());
    if (file) fd.append("resume", file, file.name);
    else fd.append("resume_text", text);
    try {
      await create.mutateAsync(fd);
      // Success: stay locked; the profile refetch replaces this form.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onConflict();
      else {
        busy.current = false;
        setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  const input = "mt-1 block w-full min-w-0 rounded border border-slate-300 px-3 py-2";
  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-xl space-y-4" noValidate>
      <div>
        <label htmlFor="rf-name" className="block text-sm font-medium">
          Name
        </label>
        <input id="rf-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div>
        <label htmlFor="rf-text" className="block text-sm font-medium">
          Resume text
        </label>
        <textarea
          id="rf-text"
          className={`${input} h-40`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="rf-count"
        />
        <p id="rf-count" className="text-xs text-slate-600">
          {text.length} / {MAX_TEXT}
        </p>
      </div>
      <div>
        <label htmlFor="rf-file" className="block text-sm font-medium">
          Resume file (.pdf, .docx or .txt, up to 5 MiB)
        </label>
        <input
          key={fileKey}
          id="rf-file"
          type="file"
          accept=".pdf,.docx,.txt"
          className={input}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file && (
          <button
            type="button"
            className="mt-1 text-sm underline"
            onClick={() => {
              setFile(null);
              setFileKey((k) => k + 1);
            }}
          >
            Remove file
          </button>
        )}
      </div>
      {touched && problem && <p className="text-sm text-amber-800">{problem}</p>}
      <button
        type="submit"
        disabled={problem !== null || pending}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Create profile"}
      </button>
      <div aria-live="polite" role="status" className="break-words text-sm">
        {pending && <p>Uploading your resume, please wait…</p>}
        {error && <p className="text-red-700">{error}</p>}
      </div>
    </form>
  );
}
