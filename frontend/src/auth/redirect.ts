import type { Role } from "./token";

export function homeFor(role: Role): string {
  return role === "admin" ? "/runs" : "/profile";
}

/** Returns `next` only when it is a same-origin relative path (open-redirect protection). */
export function safeNext(next: string | null): string | null {
  if (next === null || next.length === 0) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  // control characters or backslashes can be normalised by browsers into "//host"
  if (next.includes("\\")) return null;
  for (const ch of next) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || c === 0x7f) return null;
  }
  try {
    const base = "http://fairmatch.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return null;
    const out = u.pathname + u.search + u.hash;
    // dot-segments and encoded dots normalise away ("/.//x" -> "//x"): validate the output too
    if (!out.startsWith("/") || out.startsWith("//") || out.startsWith("/\\")) return null;
    if (out.includes("\\")) return null;
    for (const ch of out) {
      const c = ch.charCodeAt(0);
      if (c <= 0x1f || c === 0x7f) return null;
    }
    if (new URL(out, base).origin !== base) return null;
    return out;
  } catch {
    return null;
  }
}
