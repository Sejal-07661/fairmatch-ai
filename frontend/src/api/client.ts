import { loadToken } from "../auth/token";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

let unauthorizedHandler: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn;
}

// Dedupe: one handler call per burst of concurrent requests that end in 401.
let inflight = 0;
let burstHandled = false;

export type ApiInit<T = unknown> = RequestInit & {
  /** Convenience: serialised as JSON with a JSON content-type. */
  json?: unknown;
  parse?: (json: unknown) => T;
};

// Session generation: a 401 for a request issued under an older session must not sign out the next user.
let generation = 0;
export function bumpSession(): void {
  generation += 1;
}

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

function genericMessage(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status}).`;
}

async function errorFor(res: Response): Promise<ApiError> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return new ApiError(res.status, genericMessage(res.status));
  }
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && "detail" in body) {
      const d = (body as { detail: unknown }).detail;
      if (typeof d === "string" && d.trim() !== "") return new ApiError(res.status, d);
    }
  } catch {
    // not JSON
  }
  return new ApiError(res.status, genericMessage(res.status));
}

export async function apiFetch<T>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const startedIn = generation;
  const { json, parse, headers: initHeaders, body: initBody, ...rest } = init;
  const headers = new Headers(initHeaders);
  const token = loadToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body = initBody ?? null;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  } else if (typeof body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  } else if (body instanceof FormData || body instanceof URLSearchParams) {
    headers.delete("Content-Type"); // let fetch set boundary / form encoding
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  inflight += 1;
  try {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, { ...rest, headers, body });
    } catch {
      throw new ApiError(0, NETWORK_MESSAGE);
    }
    if (!res.ok) {
      const err = await errorFor(res);
      if (res.status === 401 && path !== "/auth/login" && startedIn === generation && !burstHandled) {
        burstHandled = true;
        try {
          unauthorizedHandler();
        } catch {
          // a failing handler must not mask the API error
        }
      }
      throw err;
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new ApiError(0, NETWORK_MESSAGE);
    }
    let data: unknown;
    if (text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(res.status, "The server sent an unreadable response.");
      }
    }
    if (parse) {
      try {
        return parse(data);
      } catch {
        throw new ApiError(res.status, "The server sent an unexpected response.");
      }
    }
    return data as T;
  } finally {
    inflight -= 1;
    if (inflight === 0) burstHandled = false;
  }
}

/** Retry only transient failures (network or 5xx), at most twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}
