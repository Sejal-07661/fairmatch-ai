import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import { loadToken, saveToken } from "../auth/token";
import { AuthProvider } from "../auth/AuthContext";
import Login from "./Login";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

const ui = (
  <AuthProvider>
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="*" element={<Where />} />
  </Routes>
  </AuthProvider>
);

async function fill() {
  await userEvent.type(screen.getByLabelText("Email"), "a@x.com");
  await userEvent.type(screen.getByLabelText("Password"), "password1");
}

function loginOk(token: string) {
  server.use(
    http.post("/api/auth/login", () => HttpResponse.json({ access_token: token, token_type: "bearer" })),
  );
}

describe("Login", () => {
  it("test_heading_is_sign_in", () => {
    renderApp(ui, { route: "/login" });
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_admin_login_routes_to_runs", async () => {
    const t = makeToken({ role: "admin" });
    loginOk(t);
    renderApp(ui, { route: "/login" });
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/runs"));
    expect(loadToken()).toBe(t);
  });

  it("test_candidate_login_routes_to_profile", async () => {
    loginOk(makeToken({ role: "candidate" }));
    renderApp(ui, { route: "/login" });
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/profile"));
  });

  it("test_wrong_password_shows_server_detail", async () => {
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ detail: "Incorrect email or password" }, { status: 401 })));
    renderApp(ui, { route: "/login" });
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    expect(loadToken()).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("test_submit_disabled_while_pending_and_double_click_sends_one", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post("/api/auth/login", async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({ access_token: makeToken(), token_type: "bearer" });
      }),
    );
    renderApp(ui, { route: "/login" });
    await fill();
    const btn = screen.getByRole("button", { name: "Sign in" });
    await userEvent.dblClick(btn);
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/profile"));
    expect(calls).toBe(1);
  });

  it("test_programmatic_double_submit_sends_one_request", async () => {
    let calls = 0;
    server.use(
      http.post("/api/auth/login", async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ access_token: makeToken(), token_type: "bearer" });
      }),
    );
    renderApp(ui, { route: "/login" });
    await fill();
    const form = screen.getByRole("button", { name: "Sign in" }).closest("form");
    if (!form) throw new Error("no form");
    fireEvent.submit(form);
    fireEvent.submit(form); // bypasses the disabled button
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/profile"));
    expect(calls).toBe(1);
  });

  it("test_expired_session_401_redirects_to_login", async () => {
    // A protected-page request returning 401 ends the session and lands on /login.
    const { apiFetch } = await import("../api/client");
    saveToken(makeToken());
    server.use(http.get("/api/candidates/me", () => HttpResponse.json({ detail: "expired" }, { status: 401 })));
    renderApp(
      <AuthProvider><Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<button onClick={() => void apiFetch("/candidates/me").catch(() => {})}>load</button>} />
      </Routes></AuthProvider>,
      { route: "/profile" },
    );
    await userEvent.click(screen.getByText("load"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(loadToken()).toBeNull();
  });

  describe("next param", () => {
    it("test_honours_safe_next", async () => {
      loginOk(makeToken({ role: "admin" }));
      renderApp(ui, { route: `/login?next=${encodeURIComponent("/runs/5?tab=x")}` });
      await fill();
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/runs/5?tab=x"));
    });

    it.each(["//evil.com", "http://evil.com", "https://evil.com/x", "javascript:alert(1)", "/\\evil.com", "evil.com", "///evil.com", "/\t/evil.com", "/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com", "/.%2e//evil.com", "/%2E%2E//evil.com", "/%2e/%2e//evil.com", "/././/evil.com"])(
      "test_rejects_unsafe_next_%s",
      async (next) => {
        loginOk(makeToken({ role: "admin" }));
        renderApp(ui, { route: `/login?next=${encodeURIComponent(next)}` });
        await fill();
        await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
        await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/runs"));
      },
    );
  });
});
