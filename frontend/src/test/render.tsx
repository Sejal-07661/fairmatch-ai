import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function b64url(s: string): string {
  const bin = Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makeToken(claims: Record<string, unknown> = {}): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = b64url(
    JSON.stringify({ sub: "1", role: "candidate", exp, ...claims }),
  );
  return `${header}.${payload}.signature`;
}

export function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

export function renderApp(ui: ReactElement, opts: { route?: string; client?: QueryClient } = {}) {
  const client = opts.client ?? makeClient();
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? "/"]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...result };
}
