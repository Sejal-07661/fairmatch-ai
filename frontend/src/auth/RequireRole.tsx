import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function RequireRole({
  role,
  children,
}: {
  role: "admin" | "candidate" | "any";
  children: ReactNode;
}) {
  const { user, signedOut } = useAuth();
  const location = useLocation();
  if (user === null) {
    if (signedOut) return <Navigate to="/login" replace />;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (role !== "any" && user.role !== role) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
