import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, bumpSession, setUnauthorizedHandler } from "../api/client";
import { clearToken, decodeToken, loadToken, saveToken, type Role } from "./token";

export interface AuthUser {
  userId: number;
  role: Role;
  exp: number;
}

export interface AuthApi {
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthApi | null>(null);

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function userFromStorage(): AuthUser | null {
  const t = loadToken();
  return t ? decodeToken(t) : null;
}

function parseToken(json: unknown): string {
  if (typeof json === "object" && json !== null && "access_token" in json) {
    const t = (json as { access_token: unknown }).access_token;
    if (typeof t === "string" && t !== "") return t;
  }
  throw new Error("bad token response");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(userFromStorage);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const endSession = useCallback(
    (rememberPath: boolean) => {
      clearToken();
      bumpSession();
      queryClient.clear();
      setUser(null);
      const here = locationRef.current;
      if (here.pathname === "/login") return;
      const next = here.pathname + here.search;
      navigate(rememberPath ? `/login?next=${encodeURIComponent(next)}` : "/login", { replace: true });
    },
    [navigate, queryClient],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => endSession(true));
    return () => setUnauthorizedHandler(() => {});
  }, [endSession]);

  const exp = user?.exp;
  useEffect(() => {
    if (exp === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const remaining = exp * 1000 - Date.now();
      if (remaining <= 0) {
        endSession(true);
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [exp, endSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const token = await apiFetch<string>("/auth/login", {
        method: "POST",
        body: new URLSearchParams({ username: email, password }),
        parse: parseToken,
      });
      const claims = decodeToken(token);
      if (claims === null || claims.exp * 1000 <= Date.now()) {
        clearToken();
        throw new ApiError(200, "The server returned an invalid session. Please try again.");
      }
      saveToken(token);
      bumpSession();
      queryClient.clear(); // a different user must never see the previous user's cache
      setUser(claims);
    },
    [queryClient],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      await apiFetch("/auth/register", { method: "POST", json: { email, password } });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => endSession(false), [endSession]);

  const value = useMemo(() => ({ user, login, register, logout }), [user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
