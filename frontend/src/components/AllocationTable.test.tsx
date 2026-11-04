import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "../auth/AuthContext";
import { saveToken } from "../auth/token";
import { server } from "../test/server";
import { makeAllocation, makeCandidate, makeMetrics, makeOpportunity } from "../test/fixtures";
import type { Allocation, Candidate, Metrics, Opportunity } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { AllocationTable } from "./AllocationTable";

function serve(cands: Candidate[], opps: Opportunity[]) {
  server.use(
    http.get("/api/candidates", ({ request }) => {
      const off = Number(new URL(request.url).searchParams.get("offset"));
      return HttpResponse.json(cands.slice(off, off + 100));
    }),
    http.get("/api/opportunities", ({ request }) => {
      const off = Number(new URL(request.url).searchParams.get("offset"));
      return HttpResponse.json(opps.slice(off, off + 100));
    }),
  );
}
function show(allocs: Allocation[], metrics: Metrics | undefined) {
  saveToken(makeToken({ role: "admin" }));
  return renderApp(
    <AuthProvider>
      <AllocationTable allocations={allocs} metrics={metrics} />
    </AuthProvider>,
  );
}

describe("AllocationTable", () => {
  it("test_groups_with_capacity_names_and_three_decimals", async () => {
    serve(
      [makeCandidate({ id: 1, name: "Ada" }), makeCandidate({ id: 2, name: "Bob" })],
      [makeOpportunity({ id: 1, title: "Analyst", capacity: 3 })],
    );
    show(
      [
        makeAllocation({ candidate_id: 1, opportunity_id: 1, score: 0.76641 }),
        makeAllocation({ candidate_id: 2, opportunity_id: 1, score: 0.5 }),
      ],
      makeMetrics({ gale_shapley: undefined }),
    );
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getAllByText("Analyst").length).toBe(2);
    expect(screen.getAllByText("2 / 3").length).toBe(2);
    expect(screen.getByText("0.766")).toBeInTheDocument();
    expect(screen.getByText("0.500")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("test_unknown_ids_fall_back_and_unallocated_listed_by_name", async () => {
    serve([makeCandidate({ id: 5, name: "Eve" })], []);
    show(
      [makeAllocation({ candidate_id: 99, opportunity_id: 77 })],
      makeMetrics({
        gale_shapley: undefined,
        hungarian: { total_score: 1, blocking_pairs: 0, runtime_ms: 1, unallocated: [5, 123] },
      }),
    );
    expect(await screen.findByText("Candidate #99")).toBeInTheDocument();
    expect(screen.getByText("Opportunity #77")).toBeInTheDocument();
    expect(screen.getByText("1 / ?")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Unallocated" });
    expect(await within(list).findByText("Eve")).toBeInTheDocument();
    expect(within(list).getByText("Candidate #123")).toBeInTheDocument();
  });

  it("test_algorithm_switch_only_when_both_present", async () => {
    serve([makeCandidate({ id: 1, name: "Ada" }), makeCandidate({ id: 2, name: "Bob" })], [makeOpportunity({ id: 1 })]);
    show(
      [
        makeAllocation({ algorithm: "hungarian", candidate_id: 1 }),
        makeAllocation({ algorithm: "gale_shapley", candidate_id: 2 }),
      ],
      makeMetrics(),
    );
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Gale-Shapley" }));
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("test_seats_counted_per_algorithm_same_candidate_single_seat", async () => {
    serve([makeCandidate({ id: 1, name: "Ada" })], [makeOpportunity({ id: 1, title: "Analyst", capacity: 1 })]);
    show(
      [
        makeAllocation({ algorithm: "hungarian", candidate_id: 1, opportunity_id: 1 }),
        makeAllocation({ algorithm: "gale_shapley", candidate_id: 1, opportunity_id: 1 }),
      ],
      makeMetrics(),
    );
    expect(await screen.findByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("2 / 1")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Gale-Shapley" }));
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByText("2 / 1")).toBeNull();
  });

  it("test_seats_counted_per_algorithm_different_candidates", async () => {
    serve(
      [makeCandidate({ id: 1, name: "Ada" }), makeCandidate({ id: 2, name: "Bob" })],
      [makeOpportunity({ id: 1, title: "Analyst", capacity: 2 })],
    );
    show(
      [
        makeAllocation({ algorithm: "hungarian", candidate_id: 1, opportunity_id: 1 }),
        makeAllocation({ algorithm: "gale_shapley", candidate_id: 2, opportunity_id: 1 }),
      ],
      makeMetrics(),
    );
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Gale-Shapley" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("2 / 2")).toBeNull();
  });

  it("test_truncated_banner_when_lists_hit_cap", async () => {
    server.use(
      http.get("/api/candidates", () =>
        HttpResponse.json(Array.from({ length: 100 }, (_, i) => makeCandidate({ id: i + 1 }))),
      ),
      http.get("/api/opportunities", () => HttpResponse.json([])),
    );
    show([makeAllocation()], makeMetrics({ gale_shapley: undefined }));
    expect(await screen.findByText(/names below may show as ids/i, undefined, { timeout: 25000 })).toBeInTheDocument();
  }, 30000);

  it("test_malformed_inputs_never_throw", async () => {
    serve([], []);
    show(
      [makeAllocation({ candidate_id: 1 }), makeAllocation({ candidate_id: 1 }), makeAllocation({ algorithm: "mystery" })],
      undefined,
    );
    expect(await screen.findAllByText("Candidate #1")).toHaveLength(2);
    expect(screen.getByText(/unallocated list is unavailable/i)).toBeInTheDocument();
  });

  it("test_empty_allocations", async () => {
    serve([], []);
    show([], makeMetrics());
    expect(await screen.findByText(/no allocations/i)).toBeInTheDocument();
  });

  it("test_200_candidates_paginate_at_25_under_2s", async () => {
    const cands = Array.from({ length: 200 }, (_, i) => makeCandidate({ id: i + 1, name: `Cand ${i + 1}` }));
    const opps = Array.from({ length: 40 }, (_, i) => makeOpportunity({ id: i + 1, title: `Job ${i + 1}`, capacity: 5 }));
    serve(cands, opps);
    const allocs = cands.map((c) =>
      makeAllocation({ candidate_id: c.id, opportunity_id: (c.id % 40) + 1, score: c.id / 1000 }),
    );
    const t0 = performance.now();
    show(allocs, makeMetrics({ gale_shapley: undefined }));
    expect(await screen.findByText("Page 1 of 8")).toBeInTheDocument();
    expect(await screen.findByText("Cand 1")).toBeInTheDocument();
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(screen.getAllByRole("row").length).toBe(26);
  });

  it("test_hostile_names_are_plain_text", async () => {
    const evil = "<img src=x onerror=alert(1)> ‮evil 😀";
    serve([makeCandidate({ id: 1, name: evil })], [makeOpportunity({ id: 1, title: "<script>alert(1)</script>" })]);
    const { container } = show([makeAllocation()], makeMetrics({ gale_shapley: undefined }));
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
