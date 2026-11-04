import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const links: [string, string][] =
    user?.role === "admin"
      ? [
          ["/runs", "Runs"],
          ["/opportunities", "Opportunities"],
          ["/candidates", "Candidates"],
        ]
      : user?.role === "candidate"
        ? [["/profile", "Profile"]]
        : [];
  return (
    <div>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-4 border-b p-3">
        <span className="font-semibold">FairMatch</span>
        <nav aria-label="Main" className="flex flex-wrap gap-3">
          {links.map(([to, label]) => (
            <Link key={to} to={to} className="underline">
              {label}
            </Link>
          ))}
        </nav>
        {user && (
          <button type="button" onClick={logout} className="ml-auto rounded border px-2 py-1">
            Sign out
          </button>
        )}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
