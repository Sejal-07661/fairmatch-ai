import { useRef, useState, type FormEvent } from "react";
import { useCreateOpportunity } from "../api/hooks";
import { EDUCATION_OPTIONS } from "../lib/education";

type Errors = Partial<Record<"title" | "text" | "capacity" | "experience", string>>;

const NUL = "\u0000";
const INT = /^\d+$/;
const NUM = /^\d+(\.\d+)?$/;
const field = "mt-1 w-full rounded border border-slate-300 px-2 py-2";

export function OpportunityForm() {
  const create = useCreateOpportunity();
  const busy = useRef(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [experience, setExperience] = useState("0");
  const [education, setEducation] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const errs: Errors = {};
    const t = title.trim();
    if (t.length < 1 || t.length > 200) errs.title = "Title must be 1 to 200 characters.";
    else if (title.includes(NUL)) errs.title = "Title must not contain NUL characters.";
    if (text.trim().length < 1 || text.length > 20000) errs.text = "Posting text must be 1 to 20000 characters.";
    else if (text.includes(NUL)) errs.text = "Posting text must not contain NUL characters.";
    const cap = capacity.trim();
    const capN = Number(cap);
    if (!INT.test(cap) || capN < 1 || capN > 10000) errs.capacity = "Capacity must be a whole number from 1 to 10000.";
    const exp = experience.trim();
    const expN = Number(exp);
    if (!NUM.test(exp) || !Number.isFinite(expN) || expN < 0 || expN > 80)
      errs.experience = "Minimum experience must be a number from 0 to 80.";
    setErrors(errs);
    setServerError("");
    if (Object.keys(errs).length > 0) return;

    busy.current = true;
    create.mutate(
      { title: t, posting_text: text, capacity: capN, min_experience_years: expN, min_education_level: education },
      {
        onSuccess: () => {
          setTitle("");
          setText("");
          setCapacity("1");
          setExperience("0");
          setEducation(0);
        },
        onError: (err) => setServerError(err.message),
        onSettled: () => {
          busy.current = false;
        },
      },
    );
  };

  const err = (id: string, msg?: string) =>
    msg ? (
      <p id={id} role="alert" className="mt-1 text-sm text-red-700">
        {msg}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded border border-slate-200 p-3">
      <h2 className="text-lg font-semibold">New opportunity</h2>
      <div>
        <label htmlFor="opp-title">Title</label>
        <input id="opp-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "opp-title-err" : undefined} />
        {err("opp-title-err", errors.title)}
      </div>
      <div>
        <label htmlFor="opp-text">Posting text</label>
        <textarea id="opp-text" rows={5} className={field} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(errors.text)} aria-describedby={errors.text ? "opp-text-err" : undefined} />
        {err("opp-text-err", errors.text)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="opp-cap">Capacity</label>
          <input id="opp-cap" inputMode="numeric" className={field} value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-invalid={Boolean(errors.capacity)} aria-describedby={errors.capacity ? "opp-cap-err" : undefined} />
          {err("opp-cap-err", errors.capacity)}
        </div>
        <div>
          <label htmlFor="opp-exp">Minimum experience (years)</label>
          <input id="opp-exp" inputMode="decimal" className={field} value={experience} onChange={(e) => setExperience(e.target.value)} aria-invalid={Boolean(errors.experience)} aria-describedby={errors.experience ? "opp-exp-err" : undefined} />
          {err("opp-exp-err", errors.experience)}
        </div>
        <div>
          <label htmlFor="opp-edu">Minimum education</label>
          <select id="opp-edu" className={field} value={education} onChange={(e) => setEducation(Number(e.target.value))}>
            {EDUCATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div aria-live="polite" className="text-sm text-red-700">
        {serverError}
      </div>
      <button type="submit" disabled={create.isPending} className="min-h-11 rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {create.isPending ? "Creating..." : "Create opportunity"}
      </button>
    </form>
  );
}
