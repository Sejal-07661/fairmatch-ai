import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "../auth/AuthContext";
import { saveToken } from "../auth/token";
import { server } from "../test/server";
import { makeAllocation, makeCandidate, makeOpportunity } from "../test/fixtures";
import type { Allocation } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { ExplanationPanel } from "./ExplanationPanel";

function expl(a: Allocation, over: Record<string, unknown> = {}) {
  return {
    algorithm: a.algorithm,
    candidate_id: a.candidate_id,
    opportunity_id: a.opportunity_id,
    score: a.score,
    reasons: a.reasons,
    narrative: a.narrative,
    used_fallback: a.used_fallback,
    ...over,
  };
}

function show(allocs: Allocation[], explanations: object) {
  saveToken(makeToken({ role: "admin" }));
  server.use(
    http.get("/api/candidates", () => HttpResponse.json([makeCandidate({ id: 1, name: "Ada" }), makeCandidate({ id: 2, name: "Bob" })])),
    http.get("/api/opportunities", () => HttpResponse.json([makeOpportunity({ id: 1, title: "Analyst" })])),
    http.get("/api/runs/5/explanations", () => HttpResponse.json(explanations)),
  );
  return renderApp(
    <AuthProvider>
      <ExplanationPanel runId={5} allocations={allocs} />
    </AuthProvider>,
  );
}

describe("ExplanationPanel", () => {
  it("test_selecting_shows_reasons_narrative_fallback_notice_and_breakdown", async () => {
    const a = makeAllocation({ reasons: ["Reason one", "Reason two"], narrative: "Because reasons." });
    show([a], [expl(a)]);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    const region = screen.getByRole("region", { name: /explanation/i });
    expect(within(region).getByText("Reason one")).toBeInTheDocument();
    expect(within(region).getByText("Reason two")).toBeInTheDocument();
    expect(within(region).getByText("Because reasons.")).toBeInTheDocument();
    expect(within(region).getByText("Template explanation (no AI model used)")).toBeInTheDocument();
    expect(within(region).getByRole("img", { name: /breakdown|score/i })).toBeInTheDocument();
  });

  it("test_no_fallback_notice_when_model_used", async () => {
    const a = makeAllocation({ used_fallback: false });
    show([a], [expl(a, { used_fallback: false })]);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(screen.queryByText(/template explanation/i)).toBeNull();
  });

  it("test_join_is_by_algorithm_and_candidate", async () => {
    const h = makeAllocation({ algorithm: "hungarian", candidate_id: 1, narrative: "H story" });
    const g = makeAllocation({ algorithm: "gale_shapley", candidate_id: 1, narrative: "G story" });
    show([h, g], [expl(g), expl(h)]);
    const buttons = await screen.findAllByRole("button", { name: /explain ada/i });
    await userEvent.click(buttons[1]!);
    expect(screen.getByText("G story")).toBeInTheDocument();
    await userEvent.click(buttons[0]!);
    expect(screen.getByText("H story")).toBeInTheDocument();
  });

  it("test_missing_explanation_still_shows_breakdown_with_note", async () => {
    const a = makeAllocation({ narrative: "alloc own text" });
    show([a], []);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(screen.getByText(/no separate explanation record/i)).toBeInTheDocument();
    expect(screen.getByText("alloc own text")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /breakdown|score/i })).toBeInTheDocument();
  });

  it("test_malformed_breakdown_shows_inline_error_rest_works", async () => {
    const a = makeAllocation({ breakdown: { semantic: "x" }, narrative: "Still here" });
    show([a], [expl(a)]);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid score breakdown/i);
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });

  it("test_explanations_request_failure_is_inline_with_retry", async () => {
    saveToken(makeToken({ role: "admin" }));
    server.use(
      http.get("/api/candidates", () => HttpResponse.json([])),
      http.get("/api/opportunities", () => HttpResponse.json([])),
      http.get("/api/runs/5/explanations", () => HttpResponse.json({ detail: "explain down" }, { status: 400 })),
    );
    renderApp(
      <AuthProvider>
        <ExplanationPanel runId={5} allocations={[makeAllocation()]} />
      </AuthProvider>,
    );
    expect(await screen.findByText("explain down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /explain/i })).toBeInTheDocument();
  });

  it("test_hostile_and_long_text_is_plain_clamped_with_full_text_available", async () => {
    const long = "x".repeat(5000);
    const a = makeAllocation({
      reasons: ["<img src=x onerror=alert(1)>", "‮مرحبا 😀"],
      narrative: `<script>alert(1)</script> ${long}`,
    });
    const { container } = show([a], [expl(a)]);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    const narrative = screen.getByTestId("narrative");
    expect(narrative.textContent!.length).toBeLessThan(1000);
    expect(narrative).toHaveAttribute("title", `<script>alert(1)</script> ${long}`);
    await userEvent.click(screen.getByRole("button", { name: /show full text/i }));
    expect(screen.getByTestId("narrative").textContent).toBe(`<script>alert(1)</script> ${long}`);
    expect(screen.getByRole("button", { name: /show less/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("test_malformed_explanations_payload_does_not_throw", async () => {
    const a = makeAllocation();
    show([a], [null, 5, { algorithm: "hungarian" }, expl(a, { reasons: "oops", narrative: 7 }), expl(a)]);
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(screen.getByRole("region", { name: /explanation/i })).toBeInTheDocument();
  });

  it("test_no_allocations_message", async () => {
    show([], []);
    expect(await screen.findByText(/no allocations to explain/i)).toBeInTheDocument();
  });
});
