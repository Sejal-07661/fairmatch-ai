import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { saveToken } from "../auth/token";
import { AuthProvider } from "../auth/AuthContext";
import { server } from "../test/server";
import { makeOpportunity } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { OpportunityForm } from "./OpportunityForm";

function setup() {
  saveToken(makeToken({ role: "admin" }));
  return renderApp(
    <AuthProvider>
      <OpportunityForm />
    </AuthProvider>,
  );
}
async function fill(over: Partial<Record<"title" | "text" | "cap" | "exp", string>> = {}) {
  const v = { title: "Dev", text: "Build things", cap: "3", exp: "2", ...over };
  const set = async (label: RegExp, val: string) => {
    const el = screen.getByLabelText(label);
    await userEvent.clear(el);
    if (val) await userEvent.type(el, val, { delay: null });
  };
  await set(/^title/i, v.title);
  await set(/posting text/i, v.text);
  await set(/capacity/i, v.cap);
  await set(/minimum experience/i, v.exp);
}
const submit = () => userEvent.click(screen.getByRole("button", { name: /create opportunity/i }));

describe("OpportunityForm", () => {
  it("test_invalid_values_show_inline_errors_and_send_nothing", async () => {
    let calls = 0;
    server.use(
      http.post("/api/opportunities", () => {
        calls++;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    setup();
    const bads = [
      { title: "" },
      { title: "a".repeat(201) },
      { text: "" },
      { text: "a\u0000b" },
      { cap: "0" },
      { cap: "10001" },
      { cap: "1.5" },
      { cap: "-1" },
      { cap: "" },
      { exp: "-1" },
      { exp: "81" },
      { exp: "" },
    ];
    for (const bad of bads) {
      await fill(bad);
      await submit();
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    }
    expect(calls).toBe(0);
  }, 30000);
  it("test_boundaries_accepted", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("/api/opportunities", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(makeOpportunity());
      }),
    );
    setup();
    await fill({ title: "a".repeat(200), cap: "10000", exp: "80" });
    await submit();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ capacity: 10000, min_experience_years: 80, min_education_level: 0 });
  });
  it("test_double_submit_sends_one_request_and_clears_on_success", async () => {
    let calls = 0;
    server.use(
      http.post("/api/opportunities", async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json(makeOpportunity());
      }),
    );
    setup();
    await fill();
    await userEvent.dblClick(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(screen.getByLabelText(/^title/i)).toHaveValue(""));
    expect(calls).toBe(1);
  });
  it("test_server_422_detail_in_live_region", async () => {
    server.use(
      http.post("/api/opportunities", () => HttpResponse.json({ detail: "posting too weird" }, { status: 422 })),
    );
    setup();
    await fill();
    await submit();
    const msg = await screen.findByText("posting too weird");
    expect(msg.closest("[aria-live]")).not.toBeNull();
    expect(screen.getByLabelText(/^title/i)).toHaveValue("Dev");
  });
});
