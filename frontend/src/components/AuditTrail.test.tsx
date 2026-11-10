import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { saveToken } from "../auth/token";
import { makeMetrics, makeRun } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { server } from "../test/server";
import { AUDIT_NOTE } from "./AuditTrail";

const admin = () => saveToken(makeToken({ role: "admin" }));
const serve = (run: object) => {
  server.use(
    http.get("/api/runs/5", () => HttpResponse.json(run)),
    http.get("/api/candidates", () => HttpResponse.json([])),
    http.get("/api/opportunities", () => HttpResponse.json([])),
    http.get("/api/runs/:id/explanations", () => HttpResponse.json([])),
  );
};
const trail = async () => within(await screen.findByRole("region", { name: "Audit trail" }));

beforeAll(() => import("../pages/RunDetail"));

describe("Audit trail", () => {
  it("test_renders_all_fields_with_naive_utc_timestamps", async () => {
    admin();
    serve(
      makeRun({
        id: 5,
        requested_by_email: "boss@example.com",
        created_at: "2026-11-04T10:00:00",
        started_at: "2026-11-04T10:00:01",
        finished_at: "2026-11-04T10:01:06",
        metrics: makeMetrics({ fairness_skipped: "demographics missing for 1 of 3 candidates" }),
      }),
    );
    renderApp(<App />, { route: "/runs/5" });
    const t = await trail();
    expect(t.getByText("boss@example.com")).toBeInTheDocument();
    expect(t.getByText("Both")).toBeInTheDocument();
    expect(t.getByText("done")).toBeInTheDocument();
    expect(t.getByText("1m 05s")).toBeInTheDocument();
    expect(t.getByText("demographics missing for 1 of 3 candidates")).toBeInTheDocument();
    expect(t.getByText(AUDIT_NOTE)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date/);
    expect(t.queryByText("Error")).not.toBeInTheDocument();
  });

  it("test_null_email_shows_unknown_and_html_email_is_text", async () => {
    admin();
    serve(makeRun({ id: 5, requested_by_email: null }));
    renderApp(<App />, { route: "/runs/5" });
    expect((await trail()).getByText(/Unknown \(user no longer exists\)/)).toBeInTheDocument();
  });

  it("test_failed_run_shows_error_and_unavailable_duration", async () => {
    admin();
    serve(
      makeRun({
        id: 5,
        status: "failed",
        error: "<b>solver exploded</b>",
        metrics: null,
        fairness: null,
        allocations: [],
        started_at: null,
        finished_at: null,
      }),
    );
    renderApp(<App />, { route: "/runs/5" });
    const t = await trail();
    expect(t.getByText("<b>solver exploded</b>")).toBeInTheDocument();
    expect(t.getByText("Not available")).toBeInTheDocument();
    expect(t.getByText("failed")).toBeInTheDocument();
  });
});
