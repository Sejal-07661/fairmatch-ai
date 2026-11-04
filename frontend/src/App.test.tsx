import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { makeClient, makeToken, renderApp } from "./test/render";
import { saveToken } from "./auth/token";

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

  it("test_console_errors_fail_tests", () => {
    expect(() => console.error("boom")).toThrow(/console.error/);
    expect(() => console.warn("boom")).toThrow(/console.warn/);
  });

  it("test_signed_out_admin_route_goes_to_login", () => {
    renderApp(<App />, { route: "/runs" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_admin_lands_on_runs_with_admin_nav", () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route: "/" });
    expect(screen.getByRole("heading", { name: "Runs" })).toBeInTheDocument();
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
    ["/opportunities/3", "OpportunityDetail"],
    ["/candidates", "Candidates"],
    ["/candidates/3", "CandidateDetail"],
    ["/runs/3", "RunDetail"],
  ])("test_admin_route_%s", (route, name) => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<App />, { route });
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  });
});
