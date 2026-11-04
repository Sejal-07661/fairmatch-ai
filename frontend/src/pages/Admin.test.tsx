import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "../App";
import { saveToken } from "../auth/token";
import { server } from "../test/server";
import { makeCandidate, makeOpportunity } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";

const admin = () => saveToken(makeToken({ role: "admin" }));

describe("admin pages", () => {
  it("test_candidate_role_gets_forbidden_with_zero_requests", async () => {
    const seen: string[] = [];
    const onStart = ({ request }: { request: Request }) => {
      seen.push(request.url);
    };
    server.events.on("request:start", onStart);
    saveToken(makeToken({ role: "candidate" }));
    for (const route of ["/opportunities", "/opportunities/1", "/candidates", "/candidates/1"]) {
      const { unmount } = renderApp(<App />, { route });
      expect(await screen.findByRole("heading", { name: "Forbidden" })).toBeInTheDocument();
      unmount();
    }
    server.events.removeListener("request:start", onStart);
    expect(seen).toEqual([]);
  });

  it("test_opportunities_lists_pages_via_api", async () => {
    admin();
    const calls: string[] = [];
    server.use(
      http.get("/api/opportunities", ({ request }) => {
        const u = new URL(request.url);
        calls.push(`${u.searchParams.get("limit")}/${u.searchParams.get("offset")}`);
        const off = Number(u.searchParams.get("offset"));
        const rows = Array.from({ length: off === 0 ? 25 : 3 }, (_, i) =>
          makeOpportunity({ id: off + i + 1, title: `Job ${off + i + 1}` }),
        );
        return HttpResponse.json(rows);
      }),
    );
    renderApp(<App />, { route: "/opportunities" });
    expect(await screen.findByText("Job 1")).toBeInTheDocument();
    expect(calls).toEqual(["25/0"]);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Job 26")).toBeInTheDocument();
    expect(calls).toContain("25/25");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("test_opportunities_empty", async () => {
    admin();
    server.use(http.get("/api/opportunities", () => HttpResponse.json([])));
    renderApp(<App />, { route: "/opportunities" });
    expect(await screen.findByText(/no opportunities yet/i)).toBeInTheDocument();
  });
  it("test_opportunities_error_state", async () => {
    admin();
    server.use(http.get("/api/opportunities", () => HttpResponse.json({ detail: "db down" }, { status: 400 })));
    renderApp(<App />, { route: "/opportunities" });
    expect(await screen.findByText("db down")).toBeInTheDocument();
  });

  it("test_opportunity_detail_shows_plain_text", async () => {
    admin();
    server.use(
      http.get("/api/opportunities/1", () =>
        HttpResponse.json(makeOpportunity({ posting_text: "<b>bold</b> posting", required_skills: ["python"] })),
      ),
      http.get("/api/opportunities/1/similar-candidates", () => HttpResponse.json([])),
      http.get("/api/candidates", () => HttpResponse.json([])),
    );
    renderApp(<App />, { route: "/opportunities/1" });
    expect(await screen.findByText("<b>bold</b> posting")).toBeInTheDocument();
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(await screen.findByText("No embeddings yet")).toBeInTheDocument();
  });

  it("test_candidates_table", async () => {
    admin();
    server.use(
      http.get("/api/candidates", () =>
        HttpResponse.json([makeCandidate({ id: 4, name: "Grace", used_fallback: true, education_level: 3 })]),
      ),
    );
    renderApp(<App />, { route: "/candidates" });
    const row = (await screen.findByText("Grace")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Master")).toBeInTheDocument();
    expect(within(row).getByText(/basic mode/i)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /view/i })).toHaveAttribute("href", "/candidates/4");
  });

  it("test_candidate_detail_has_badge_editor_and_no_resume", async () => {
    admin();
    server.use(
      http.get("/api/candidates/4", () =>
        HttpResponse.json({ ...makeCandidate({ id: 4, name: "Grace", used_fallback: true }), resume_text: "SECRET RESUME" }),
      ),
      http.get("/api/candidates/4/demographics", () => HttpResponse.json({ detail: "nf" }, { status: 404 })),
    );
    renderApp(<App />, { route: "/candidates/4" });
    expect(await screen.findByRole("heading", { name: "Grace" })).toBeInTheDocument();
    expect(screen.getByText(/basic mode/i)).toBeInTheDocument();
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText(/SECRET RESUME/)).toBeNull();
    expect(screen.getByLabelText(/group label/i)).toBeInTheDocument();
  });
});
