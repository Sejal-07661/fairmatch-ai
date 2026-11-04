import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { saveToken } from "../auth/token";
import { AuthProvider } from "../auth/AuthContext";
import { server } from "../test/server";
import { makeCandidate } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { SimilarCandidates } from "./SimilarCandidates";

function setup() {
  saveToken(makeToken({ role: "admin" }));
  renderApp(
    <AuthProvider>
      <SimilarCandidates opportunityId={7} />
    </AuthProvider>,
  );
}
const cands = () => http.get("/api/candidates", () => HttpResponse.json([makeCandidate({ id: 1, name: "Ada" })]));
const sim = "/api/opportunities/7/similar-candidates";

describe("SimilarCandidates", () => {
  it("test_sorted_as_returned_percent_and_fallback_name", async () => {
    server.use(
      cands(),
      http.get(sim, () =>
        HttpResponse.json([
          { candidate_id: 1, similarity: 0.8766 },
          { candidate_id: 9, similarity: 0.5 },
        ]),
      ),
    );
    setup();
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Ada");
    expect(items[0]).toHaveTextContent("87.7%");
    expect(items[1]).toHaveTextContent("Candidate #9");
    expect(items[1]).toHaveTextContent("50.0%");
  });
  it("test_empty_state", async () => {
    server.use(cands(), http.get(sim, () => HttpResponse.json([])));
    setup();
    expect(await screen.findByText("No embeddings yet")).toBeInTheDocument();
  });
  it("test_limit_change_refetches", async () => {
    const limits: string[] = [];
    server.use(
      cands(),
      http.get(sim, ({ request }) => {
        limits.push(new URL(request.url).searchParams.get("limit") ?? "");
        return HttpResponse.json([]);
      }),
    );
    setup();
    await waitFor(() => expect(limits).toEqual(["10"]));
    await userEvent.selectOptions(screen.getByLabelText(/show top/i), "25");
    await waitFor(() => expect(limits).toEqual(["10", "25"]));
  });
  it("test_error_state_with_retry", async () => {
    let n = 0;
    server.use(
      cands(),
      http.get(sim, () => (n++ === 0 ? HttpResponse.json({ detail: "boom" }, { status: 400 }) : HttpResponse.json([]))),
    );
    setup();
    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("No embeddings yet")).toBeInTheDocument();
  });
});
