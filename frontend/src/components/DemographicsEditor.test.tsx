import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { saveToken } from "../auth/token";
import { AuthProvider } from "../auth/AuthContext";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import { DemographicsEditor } from "./DemographicsEditor";

const url = "/api/candidates/5/demographics";
function setup() {
  saveToken(makeToken({ role: "admin" }));
  renderApp(
    <AuthProvider>
      <DemographicsEditor candidateId={5} />
    </AuthProvider>,
  );
}
const save = () => userEvent.click(screen.getByRole("button", { name: /save/i }));
const notFound = () => http.get(url, () => HttpResponse.json({ detail: "Demographics not set" }, { status: 404 }));

describe("DemographicsEditor", () => {
  it("test_404_shows_not_set_and_explains_purpose", async () => {
    server.use(notFound());
    setup();
    expect(await screen.findByText("Not set")).toBeInTheDocument();
    expect(screen.getByText(/only for the fairness audit and never for scoring/i)).toBeInTheDocument();
  });
  it("test_existing_value_prefills_and_save_sends_trimmed_put", async () => {
    let body: unknown;
    server.use(
      http.get(url, () => HttpResponse.json({ candidate_id: 5, group_label: "A" })),
      http.put(url, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ candidate_id: 5, group_label: "B" });
      }),
    );
    setup();
    const input = await screen.findByLabelText(/group label/i);
    await waitFor(() => expect(input).toHaveValue("A"));
    await userEvent.clear(input);
    await userEvent.type(input, "  B  ");
    await save();
    await waitFor(() => expect(body).toEqual({ group_label: "B" }));
  });
  it("test_64_ok_65_rejected_and_nul_and_blank", async () => {
    let puts = 0;
    server.use(
      notFound(),
      http.put(url, () => {
        puts++;
        return HttpResponse.json({ candidate_id: 5, group_label: "x" });
      }),
    );
    setup();
    const input = await screen.findByLabelText(/group label/i);
    for (const bad of ["a".repeat(65), "a\u0000b", "   "]) {
      await userEvent.clear(input);
      await userEvent.type(input, bad, { delay: null });
      await save();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    }
    expect(puts).toBe(0);
    await userEvent.clear(input);
    await userEvent.type(input, "a".repeat(64), { delay: null });
    await save();
    await waitFor(() => expect(puts).toBe(1));
  });
  it("test_403_detail_shown", async () => {
    server.use(
      notFound(),
      http.put(url, () => HttpResponse.json({ detail: "Admin only" }, { status: 403 })),
    );
    setup();
    await userEvent.type(await screen.findByLabelText(/group label/i), "G");
    await save();
    expect(await screen.findByText("Admin only")).toBeInTheDocument();
  });
});
