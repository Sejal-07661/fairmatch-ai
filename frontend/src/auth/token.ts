const KEY = "fairmatch.token";

export type Role = "candidate" | "admin";
export interface TokenClaims {
  userId: number;
  role: Role;
  exp: number;
}

function base64UrlToText(input: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeToken(t: string): TokenClaims | null {
  if (typeof t !== "string") return null;
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  const text = base64UrlToText(parts[1] ?? "");
  if (text === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { sub, role, exp } = payload as Record<string, unknown>;
  if (typeof sub !== "string" || !/^[1-9]\d*$/.test(sub)) return null;
  const userId = Number(sub);
  if (!Number.isSafeInteger(userId)) return null;
  if (role !== "candidate" && role !== "admin") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { userId, role, exp };
}

export function saveToken(t: string): void {
  try {
    sessionStorage.setItem(KEY, t);
  } catch {
    // storage unavailable: session will not persist
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function loadToken(): string | null {
  let t: string | null;
  try {
    t = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (t === null) return null;
  const claims = decodeToken(t);
  if (claims === null || claims.exp <= Date.now() / 1000) {
    clearToken();
    return null;
  }
  return t;
}
