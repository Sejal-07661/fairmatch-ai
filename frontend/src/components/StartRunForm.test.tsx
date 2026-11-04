import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { saveToken } from "../auth/token";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import { StartRunForm } from "./StartRunForm";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
function setup() {
  saveToken(makeToken({ role: "admin" }));
  return renderApp(
    <AuthProvider>
      <Routes>
        <Route path="/" element={<StartRunForm />} />
        <Route path="/runs/:id" element={<Where />} />
      </Routes>
    </AuthProvider>,
  );
}

describe("StartRunForm", () => {
  it("test_default_is_both_and_options_are_labelled", () => {
    setup();
    expect(screen.getByRole("radio", { name: /both/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hungarian" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Gale-Shapley" })).not.toBeChecked();
    expect(screen.getByRole("group", { name: /algorithm/i })).toBeInTheDocument();
  });

  it("test_submit_sends_selection_and_navigates_on_202", async () => {
    let body: unknown;
    server.use(
      http.post("/api/runs", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 42, status: "pending" }, { status: 202 });
      }),
    );
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Hungarian" }));
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/runs/42");
    expect(body).toEqual({ algorithm: "hungarian" });
  });

  it.each([
    [422, "No opportunities with seats available."],
    [422, "Too many candidates for one run (limit 500)."],
    [503, "Queue unavailable, try later."],
  ])("test_server_%i_detail_shown_verbatim", async (status, detail) => {
    server.use(http.post("/api/runs", () => HttpResponse.json({ detail }, { status })));
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    const msg = await screen.findByText(detail);
    expect(msg.closest("[aria-live]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Start run" })).toBeEnabled();
  });

  it("test_double_click_and_enter_spam_send_one_request", async () => {
    let count = 0;
    server.use(
      http.post("/api/runs", async () => {
        count += 1;
        await new Promise((r) => setTimeout(r, 80));
        return HttpResponse.json({ id: 7, status: "pending" }, { status: 202 });
      }),
    );
    setup();
    const btn = screen.getByRole("button", { name: "Start run" });
    await userEvent.dblClick(btn);
    btn.focus();
    await userEvent.keyboard("{Enter}{Enter}{Enter}");
    expect(await screen.findByTestId("where")).toHaveTextContent("/runs/7");
    expect(count).toBe(1);
  });

  it("test_two_submits_in_same_tick_send_one_request", async () => {
    let count = 0;
    server.use(
      http.post("/api/runs", async () => {
        count += 1;
        await new Promise((r) => setTimeout(r, 80));
        return HttpResponse.json({ id: 11, status: "pending" }, { status: 202 });
      }),
    );
    setup();
    const form = screen.getByRole("button", { name: "Start run" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await screen.findByTestId("where")).toHaveTextContent("/runs/11");
    expect(count).toBe(1);
  });

  it("test_button_disabled_while_pending", async () => {
    server.use(
      http.post("/api/runs", async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ id: 9, status: "pending" }, { status: 202 });
      }),
    );
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /starting/i })).toBeDisabled());
    expect(await screen.findByTestId("where")).toBeInTheDocument();
  });
});
