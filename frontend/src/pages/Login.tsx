import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homeFor, safeNext } from "../auth/redirect";

export function describeError(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
}

export default function Login() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  if (user) return <Navigate to={safeNext(params.get("next")) ?? homeFor(user.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    } finally {
      busy.current = false;
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <label className="block">
          Email
          <input type="email" required autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block">
          Password
          <input type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border p-2" />
        </label>
        <div aria-live="polite">
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </div>
        <button type="submit" disabled={pending} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">
          Sign in
        </button>
      </form>
      <p className="mt-4 text-sm">
        No account? <Link to="/register" className="underline">Create one</Link>
      </p>
    </main>
  );
}
