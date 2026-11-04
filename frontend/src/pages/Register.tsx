import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homeFor } from "../auth/redirect";
import { describeError } from "./Login";

export default function Register() {
  const { user, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await register(email, password);
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    } finally {
      busy.current = false;
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Create account</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block">
          Email
          <input type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block">
          Password
          <input type="password" required minLength={8} autoComplete="new-password" value={password}
            aria-describedby="pw-hint" onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border p-2" />
        </label>
        <p id="pw-hint" className="text-sm text-slate-600">Use at least 8 characters.</p>
        <div aria-live="polite">
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </div>
        <button type="submit" disabled={pending} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already registered? <Link to="/login" className="underline">Sign in</Link>
      </p>
    </main>
  );
}
