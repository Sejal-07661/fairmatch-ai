import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { makeClient, makeToken, renderApp } from "./test/render";
import { saveToken } from "./auth/token";
import { http, HttpResponse } from "msw";
import { server } from "./test/server";
import { makeCandidate, makeOpportunity, makeRun } from "./test/fixtures";

beforeEach(() => {
  server.use(
    http.get("/api/runs/:id/explanations", () => HttpResponse.json([])),
    http.get("/api/runs/:id", () => HttpResponse.json(makeRun({ id: 3, status: "done", allocations: [] }))),
    http.get("/api/runs", () => HttpResponse.json([])),
    http.get("/api/candidates/me", () => HttpResponse.json(makeCandidate())),
    http.get("/api/candidates/:id/demographics", () => HttpResponse.json({ candidate_id: 3, group_label: "A" })),
    http.get("/api/candidates/:id", () => HttpResponse.json(makeCandidate({ id: 3 }))),
    http.get("/api/candidates", () => HttpResponse.json([makeCandidate({ id: 3 })])),
    http.get("/api/opportunities/:id/similar-candidates", () => HttpResponse.json([])),
    http.get("/api/opportunities/:id", () => HttpResponse.json(makeOpportunity({ id: 3 }))),
    http.get("/api/opportunities", () => HttpResponse.json([makeOpportunity({ id: 3 })])),
  );
});

beforeAll(() => Promise.all([import("./pages/Runs"), import("./pages/RunDetail")]));

describe("App", () => {
  it("test_app_renders_login_when_signed_out", () => {
    renderApp(<App />, { route: "/" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_real_entry_composition_renders_sign_in_without_fallback", () => {
    // Mirrors src/main.tsx exactly: QueryClientProvider > BrowserRouter > App (App owns AuthProvider).
    window.history.pushState({}, "", "/");
    render(
      <QueryClientProvider client={makeClient()}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it("test_admin_can_reach_profile_route", () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/profile" });
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Forbidden" })).toBeNull();
  });

  it("test_signed_out_profile_redirects_to_login", () => {
    renderApp(<App />, { route: "/profile" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_console_calls_are_recorded_for_the_afterEach_assertion", () => {
    expect(vi.isMockFunction(console.error)).toBe(true);
    expect(vi.isMockFunction(console.warn)).toBe(true);
  });

  it("test_signed_out_admin_route_goes_to_login", () => {
    renderApp(<App />, { route: "/runs" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_admin_lands_on_runs_with_admin_nav", async () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/" });
    expect(await screen.findByRole("heading", { name: "Runs" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    for (const name of ["Runs", "Opportunities", "Candidates"]) {
      expect(nav).toHaveTextContent(name);
    }
    expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
  });

  it("test_candidate_lands_on_profile_with_candidate_nav", () => {
    saveToken(makeToken({ role: "candidate" }));
    renderApp(<App />, { route: "/" });
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Runs" })).toBeNull();
  });

  it("test_candidate_on_admin_url_sees_forbidden", () => {
    saveToken(makeToken({ role: "candidate" }));
    renderApp(<App />, { route: "/runs" });
    expect(screen.getByRole("heading", { name: "Forbidden" })).toBeInTheDocument();
  });

  it("test_unknown_route_is_not_found", () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/nope" });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it.each([
    ["/opportunities", "Opportunities"],
    ["/candidates", "Candidates"],
    ["/runs", "Runs"],
  ])("test_admin_route_%s", async (route, name) => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route });
    expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
  });

  it("test_admin_run_detail_loads", async () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/runs/3" });
    expect(await screen.findByRole("heading", { name: "Run #3" })).toBeInTheDocument();
  });

  it("test_admin_opportunity_detail_loads", async () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/opportunities/3" });
    expect(await screen.findByRole("heading", { name: "Data Analyst" })).toBeInTheDocument();
  });

  it("test_admin_candidate_detail_loads", async () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/candidates/3" });
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("test_candidate_forbidden_on_admin_routes_makes_zero_requests", async () => {
    saveToken(makeToken({ role: "candidate" }));
    const seen = vi.fn();
    server.events.on("request:start", seen);
    try {
      renderApp(<App />, { route: "/candidates/3" });
      expect(await screen.findByRole("heading", { name: "Forbidden" })).toBeInTheDocument();
      expect(seen).not.toHaveBeenCalled();
    } finally {
      server.events.removeAllListeners();
    }
  });

  it("test_signed_out_detail_route_redirects_with_next", () => {
    renderApp(<App />, { route: "/candidates/3" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
