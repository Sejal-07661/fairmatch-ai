import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { saveToken } from "../auth/token";
import { makeRun } from "../test/fixtures";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";

const admin = () => saveToken(makeToken({ role: "admin" }));
const summary = (o: Record<string, unknown>) => {
  const { allocations: _a, ...rest } = makeRun(o as never);
  void _a;
  return rest;
};

describe("Runs page", () => {
  it("test_lists_runs_newest_first_with_labels_and_badges", async () => {
    admin();
    server.use(
      http.get("/api/runs", () =>
        HttpResponse.json([
          summary({ id: 1, algorithm: "hungarian", status: "done", created_at: "2026-11-04T09:00:00" }),
          summary({ id: 2, algorithm: "both", status: "failed", created_at: "2026-11-04T10:00:00", finished_at: null }),
          summary({ id: 3, algorithm: "gale_shapley", status: "running", created_at: "garbage", finished_at: null }),
        ]),
      ),
    );
    renderApp(<App />, { route: "/runs" });
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["#3", "#2", "#1"].map((s) => s.replace("#", "")).map((s) => `Run ${s}`));
    expect(within(rows[0]!).getByText("Gale-Shapley")).toBeInTheDocument();
    expect(within(rows[0]!).getByTestId("run-status-badge")).toHaveTextContent("Running");
    expect(within(rows[1]!).getByTestId("run-status-badge")).toHaveTextContent("Failed");
    expect(within(rows[0]!).getByText("unknown")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/);
    expect(screen.getByRole("link", { name: "Run 2" })).toHaveAttribute("href", "/runs/2");
  });

  it("test_heading_order_and_start_form_present", async () => {
    admin();
    server.use(http.get("/api/runs", () => HttpResponse.json([])));
    renderApp(<App />, { route: "/runs" });
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
    const levels = screen.getAllByRole("heading").map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.slice(1).every((l) => l === 2)).toBe(true);
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("test_paginates_with_limit_and_offset", async () => {
    admin();
    const calls: string[] = [];
    server.use(
      http.get("/api/runs", ({ request }) => {
        const u = new URL(request.url);
        calls.push(`${u.searchParams.get("limit")}/${u.searchParams.get("offset")}`);
        const off = Number(u.searchParams.get("offset"));
        const n = off === 0 ? 25 : 2;
        return HttpResponse.json(Array.from({ length: n }, (_, i) => summary({ id: off + i + 1 })));
      }),
    );
    renderApp(<App />, { route: "/runs" });
    expect(await screen.findByRole("link", { name: "Run 25" })).toBeInTheDocument();
    expect(calls).toEqual(["25/0"]);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByRole("link", { name: "Run 27" })).toBeInTheDocument();
    expect(calls).toContain("25/25");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("test_error_state_with_retry", async () => {
    admin();
    let fail = true;
    server.use(
      http.get("/api/runs", () =>
        fail ? HttpResponse.json({ detail: "runs down" }, { status: 400 }) : HttpResponse.json([summary({ id: 9 })]),
      ),
    );
    renderApp(<App />, { route: "/runs" });
    expect(await screen.findByText("runs down")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Run 9" })).toBeInTheDocument();
  });

  it("test_start_run_navigates_to_detail", async () => {
    admin();
    server.use(
      http.get("/api/runs", () => HttpResponse.json([])),
      http.post("/api/runs", () => HttpResponse.json({ id: 8, status: "pending" }, { status: 202 })),
      http.get("/api/runs/8", () => HttpResponse.json(makeRun({ id: 8, status: "pending", metrics: null, fairness: null, allocations: [] }))),
    );
    renderApp(<App />, { route: "/runs" });
    await userEvent.click(await screen.findByRole("button", { name: "Start run" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Run #8" })).toBeInTheDocument();
  });

  it("test_malformed_rows_do_not_blank_the_page", async () => {
    admin();
    server.use(
      http.get("/api/runs", () =>
        HttpResponse.json([{ id: 1, algorithm: null, status: 5, created_at: null, finished_at: {} }, summary({ id: 1 })]),
      ),
    );
    renderApp(<App />, { route: "/runs" });
    expect((await screen.findAllByRole("link", { name: "Run 1" })).length).toBe(2);
  });
});
