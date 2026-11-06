import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { App } from "../App";
import { saveToken } from "../auth/token";
import { makeAllocation, makeCandidate, makeMetrics, makeOpportunity, makeRun } from "../test/fixtures";
import type { Run } from "../test/fixtures";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import realRun from "./__fixtures__/real-run.json";
import realExplanations from "./__fixtures__/real-explanations.json";

const admin = () => saveToken(makeToken({ role: "admin" }));

function serveSide(over: { explanations?: object } = {}) {
  server.use(
    http.get("/api/candidates", () =>
      HttpResponse.json([makeCandidate({ id: 1, name: "Ada" }), makeCandidate({ id: 2, name: "Bob" })]),
    ),
    http.get("/api/opportunities", () => HttpResponse.json([makeOpportunity({ id: 1, title: "Analyst", capacity: 2 })])),
    http.get("/api/runs/:id/explanations", () => HttpResponse.json(over.explanations ?? [])),
  );
}
function serveRun(run: object) {
  server.use(http.get("/api/runs/5", () => HttpResponse.json(run)));
}
beforeAll(() => import("./RunDetail"));
const open = (route = "/runs/5") => renderApp(<App />, { route });
const doneRun = (o: Partial<Run> = {}) =>
  makeRun({
    id: 5,
    allocations: [
      makeAllocation({ candidate_id: 1, opportunity_id: 1, score: 0.8 }),
      makeAllocation({ candidate_id: 77, opportunity_id: 1, score: 0.5 }),
    ],
    metrics: makeMetrics({
      hungarian: { total_score: 1.3, blocking_pairs: 0, runtime_ms: 1, unallocated: [2, 404] },
      gale_shapley: undefined,
    }),
    ...o,
  });

describe("RunDetail polling (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
      now: Date.parse("2026-11-04T10:00:02Z"),
    });
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("test_pending_to_running_to_done_polls_then_stops", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        const status = n === 1 ? "pending" : n === 2 ? "running" : "done";
        return HttpResponse.json(
          status === "done" ? doneRun() : makeRun({ id: 5, status, metrics: null, fairness: null, allocations: [], finished_at: null }),
        );
      }),
    );
    open();
    await advance(10);
    await advance(10);
    expect(n).toBe(1);
    expect(screen.getByTestId("run-status-badge")).toHaveTextContent("Pending");
    expect(screen.queryByRole("alert")).toBeNull();
    await advance(1500);
    expect(n).toBe(2);
    expect(screen.getByTestId("run-status-badge")).toHaveTextContent("Running");
    await advance(1500);
    expect(n).toBe(3);
    expect(screen.getByTestId("run-status-badge")).toHaveTextContent("Done");
    await advance(20_000);
    expect(n).toBe(3);
  });

  it("test_failed_stops_polling_and_shows_error", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json(
          n === 1
            ? makeRun({ id: 5, status: "running", metrics: null, fairness: null, allocations: [] })
            : makeRun({ id: 5, status: "failed", error: "solver exploded", metrics: null, fairness: null, allocations: [] }),
        );
      }),
    );
    open();
    await advance(1600);
    expect(screen.getByText("solver exploded")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    await advance(20_000);
    expect(n).toBe(2);
  });

  it("test_404_stops_and_shows_run_not_found", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json({ detail: "Run not found" }, { status: 404 });
      }),
    );
    open();
    await advance(20_000);
    expect(screen.getByText("Run not found")).toBeInTheDocument();
    expect(n).toBe(1);
  });

  it("test_404_after_pending_stops_polling", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return n === 1
          ? HttpResponse.json(makeRun({ id: 5, status: "pending", metrics: null, fairness: null, allocations: [] }))
          : HttpResponse.json({ detail: "gone" }, { status: 404 });
      }),
    );
    open();
    await advance(1600);
    expect(screen.getByText("Run not found")).toBeInTheDocument();
    await advance(20_000);
    expect(n).toBe(2);
  });

  it("test_unmount_stops_polling", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json(makeRun({ id: 5, status: "running", metrics: null, fairness: null, allocations: [] }));
      }),
    );
    const { unmount } = open();
    await advance(3100);
    const before = n;
    expect(before).toBeGreaterThanOrEqual(2);
    unmount();
    await advance(20_000);
    expect(n).toBe(before);
  });

  it("test_requests_never_overlap_with_slow_responses", async () => {
    admin();
    serveSide();
    let inflight = 0;
    let max = 0;
    let n = 0;
    server.use(
      http.get("/api/runs/5", async () => {
        inflight += 1;
        n += 1;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 4000));
        inflight -= 1;
        return HttpResponse.json(makeRun({ id: 5, status: "running", metrics: null, fairness: null, allocations: [] }));
      }),
    );
    open();
    await advance(20_000);
    expect(n).toBeGreaterThan(1);
    expect(max).toBe(1);
  });

  it("test_stuck_note_and_waiting_time_for_old_pending_run", async () => {
    admin();
    serveSide();
    serveRun(makeRun({ id: 5, status: "pending", created_at: "2026-11-04T09:58:00", metrics: null, fairness: null, allocations: [] }));
    open();
    await advance(10);
    expect(screen.getByText(/waiting 2m 0\ds/i)).toBeInTheDocument();
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
  });

  it("test_refresh_button_refetches", async () => {
    admin();
    serveSide();
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json(makeRun({ id: 5, status: "pending", metrics: null, fairness: null, allocations: [] }));
      }),
    );
    open();
    await advance(10);
    expect(n).toBe(1);
    const btn = screen.getByRole("button", { name: "Refresh" });
    await act(async () => {
      btn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(n).toBe(2);
  });
});

describe("RunDetail results", () => {
  it("test_done_run_renders_tabs_results_capacity_unallocated_and_id_fallback", async () => {
    admin();
    serveSide();
    serveRun(doneRun());
    open();
    expect(await screen.findByRole("heading", { level: 1, name: /run #5/i })).toBeInTheDocument();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Candidate #77")).toBeInTheDocument();
    expect(screen.getAllByText("2 / 2").length).toBe(2);
    const list = screen.getByRole("list", { name: "Unallocated" });
    expect(await within(list).findByText("Bob")).toBeInTheDocument();
    expect(within(list).getByText("Candidate #404")).toBeInTheDocument();
  });

  it("test_timestamps_naive_are_utc_and_garbage_is_unknown", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ created_at: "2026-11-04T09:16:24.526954", finished_at: "garbage" }));
    open();
    await screen.findByText("Ada");
    const t = document.querySelector("[title='2026-11-04T09:16:24.526954']");
    expect(t).not.toBeNull();
    expect(t!.textContent).not.toMatch(/Invalid|NaN|unknown/);
    expect(document.querySelector("[title='garbage']")).toHaveTextContent("unknown");
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/);
  });

  it("test_invalid_id_shows_not_found_without_requests", async () => {
    admin();
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => void seen.push(request.url));
    open("/runs/abc");
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    server.events.removeAllListeners();
    expect(seen).toEqual([]);
  });

  it("test_server_error_shows_message_and_retry", async () => {
    admin();
    serveSide();
    server.use(http.get("/api/runs/5", () => HttpResponse.json({ detail: "db exploded" }, { status: 400 })));
    open();
    expect(await screen.findByText("db exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("RunDetail tabs", () => {
  it("test_tabs_have_roles_and_arrow_key_navigation", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ metrics: makeMetrics() }));
    open();
    const tablist = await screen.findByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Results", "Comparison", "Fairness", "Explanations"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Results");
    tabs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
    await userEvent.keyboard("{End}");
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowLeft}");
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("test_comparison_charts_when_both_algorithms_present", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ metrics: makeMetrics() }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Comparison" }));
    expect(await screen.findByRole("heading", { name: "Total score" })).toBeInTheDocument();
  });

  it("test_single_algorithm_run_shows_summary_not_charts", async () => {
    admin();
    serveSide();
    serveRun(doneRun());
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Comparison" }));
    expect(screen.getByText(/only hungarian ran/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Total score" })).toBeNull();
    expect(screen.getByText("1.30")).toBeInTheDocument();
  });

  it("test_fairness_tab_shows_skipped_reason", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ fairness: null, metrics: makeMetrics({ fairness_skipped: "No demographics recorded" }) }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Fairness" }));
    expect(screen.getByText("No demographics recorded")).toBeInTheDocument();
  });

  it("test_fairness_null_without_reason_is_honest_empty_state", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ fairness: null }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Fairness" }));
    expect(screen.getByText(/fairness was not computed/i)).toBeInTheDocument();
  });

  it("test_fairness_tab_renders_server_pass_fail", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ metrics: makeMetrics() }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Fairness" }));
    expect((await screen.findAllByTestId("status-badge")).length).toBeGreaterThan(0);
  });

  it("test_malformed_fairness_shows_error_panel_in_fairness_tab_only", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ fairness: { hungarian: "bad" } }));
    open();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Fairness" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid fairness data/i);
  });

  it("test_explanation_selection_shows_reasons_and_breakdown", async () => {
    admin();
    const a = makeAllocation({ candidate_id: 1, opportunity_id: 1, reasons: ["Great python"], narrative: "Narr" });
    serveSide({
      explanations: [
        { algorithm: "hungarian", candidate_id: 1, opportunity_id: 1, score: 0.8, reasons: ["Great python"], narrative: "Narr", used_fallback: true },
      ],
    });
    serveRun(doneRun({ allocations: [a] }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Explanations" }));
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(screen.getByText("Great python")).toBeInTheDocument();
    expect(screen.getByText("Template explanation (no AI model used)")).toBeInTheDocument();
  });

  it("test_run_detail_never_requests_demographics_or_shows_group_labels", async () => {
    admin();
    const demoRequests: string[] = [];
    server.use(
      http.get("/api/candidates/:id/demographics", ({ request }) => {
        demoRequests.push(request.url);
        return HttpResponse.json({ candidate_id: 1, group_label: "SecretGroup" });
      }),
    );
    const a = makeAllocation({ candidate_id: 1, opportunity_id: 1, reasons: ["Great python"], narrative: "Narr" });
    serveSide({
      explanations: [
        { algorithm: "hungarian", candidate_id: 1, opportunity_id: 1, score: 0.8, reasons: ["Great python"], narrative: "Narr", used_fallback: false },
      ],
    });
    serveRun(doneRun({ allocations: [a] }));
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Explanations" }));
    await userEvent.click(await screen.findByRole("button", { name: /explain ada/i }));
    expect(await screen.findByText("Great python")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("SecretGroup");
    expect(demoRequests).toEqual([]);
  });

  it.each([
    ["missing unallocated", { hungarian: { total_score: 1, blocking_pairs: 0, runtime_ms: 1 } }],
    ["null", null],
    ["strings", { hungarian: { total_score: "x", blocking_pairs: "y", runtime_ms: "z", unallocated: "no" } }],
  ])("test_malformed_metrics_%s_shows_error_panel_other_tabs_still_work", async (_n, metrics) => {
    admin();
    serveSide();
    serveRun(doneRun({ metrics }));
    open();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/metrics could not be read/i);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/unallocated list is unavailable/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Explanations" }));
    expect(await screen.findByRole("button", { name: /explain ada/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(screen.getByText(/comparison is unavailable/i)).toBeInTheDocument();
  });

  it("test_empty_allocations_done_run", async () => {
    admin();
    serveSide();
    serveRun(doneRun({ allocations: [] }));
    open();
    expect(await screen.findByText(/no allocations in this run/i)).toBeInTheDocument();
  });
});

describe("RunDetail access and real payload", () => {
  it("test_candidate_role_gets_forbidden_with_zero_requests", async () => {
    saveToken(makeToken({ role: "candidate" }));
    const seen: string[] = [];
    const on = ({ request }: { request: Request }) => void seen.push(request.url);
    server.events.on("request:start", on);
    for (const route of ["/runs", "/runs/5"]) {
      const { unmount } = open(route);
      expect(await screen.findByRole("heading", { name: "Forbidden" })).toBeInTheDocument();
      unmount();
    }
    server.events.removeListener("request:start", on);
    expect(seen).toEqual([]);
  });

  it("test_real_run_payload_renders_end_to_end", async () => {
    admin();
    server.use(
      http.get("/api/candidates", () =>
        HttpResponse.json([
          makeCandidate({ id: 1, name: "Cand0 <b>x</b>" }),
          makeCandidate({ id: 2, name: "Cand1" }),
          makeCandidate({ id: 3, name: "Cand2" }),
        ]),
      ),
      http.get("/api/opportunities", () =>
        HttpResponse.json([makeOpportunity({ id: 1, title: "Opp A" }), makeOpportunity({ id: 2, title: "Opp B" })]),
      ),
      http.get("/api/runs/3", () => HttpResponse.json(realRun)),
      http.get("/api/runs/3/explanations", () => HttpResponse.json(realExplanations)),
    );
    const { container } = open("/runs/3");
    expect(await screen.findByText("Cand0 <b>x</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(await screen.findByRole("heading", { name: "Total score" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Fairness" }));
    expect((await screen.findAllByTestId("status-badge")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "Explanations" }));
    const btns = await screen.findAllByRole("button", { name: /explain cand0/i });
    await userEvent.click(btns[0]!);
    const region = screen.getByRole("region", { name: /^explanation$/i });
    expect(within(region).getByText("Template explanation (no AI model used)")).toBeInTheDocument();
    await waitFor(() => expect(within(region).getByRole("img")).toBeInTheDocument());
  });
});
