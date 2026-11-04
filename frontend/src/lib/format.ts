const HAS_ZONE = /(Z|[+-]\d{2}(:?\d{2})?)$/i;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?/;

/**
 * Parses an API timestamp. SQLite deployments return naive ISO strings (no Z/offset);
 * those are UTC, so Z is appended. Returns null when the value cannot be parsed.
 */
export function parseApiDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!ISO_LIKE.test(s)) return null;
  const hasTime = /[T ]\d{2}:/.test(s);
  let iso = s.replace(" ", "T");
  if (hasTime && !HAS_ZONE.test(iso)) iso += "Z";
  if (!hasTime) iso += "T00:00:00Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** Local display text plus the raw value for a title attribute. */
export function formatTimestamp(raw: unknown): { text: string; title: string } {
  const d = parseApiDate(raw);
  const title = typeof raw === "string" ? raw : "";
  return { text: d ? fmt.format(d) : "unknown", title };
}

export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}
