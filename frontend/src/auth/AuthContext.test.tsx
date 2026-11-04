import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import { AuthProvider, useAuth } from "./AuthContext";
import { loadToken, saveToken } from "./token";

function Probe() {
  const { user, login, logout, register } = useAuth();
  const loc = useLocation();
  return (
    <div>
      <p data-testid="user">{user ? `${user.userId}:${user.role}` : "none"}</p>
      <p data-testid="loc">{loc.pathname + loc.search}</p>
      <button onClick={() => void login("a@x.com", "password1").catch(() => {})}>login</button>
      <button onClick={() => void register("n@x.com", "password1").catch(() => {})}>register</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

const ui = (
  <AuthProvider>
    <Routes>
      <Route path="*" element={<Probe />} />
    </Routes>
  </AuthProvider>
);

function loginReturns(token: string) {
  server.use(
    http.post("/api/auth/login", () => HttpResponse.json({ access_token: token, token_type: "bearer" })),
  );
}

describe("AuthProvider", () => {
  it("test_login_stores_token_and_sets_user", async () => {
    const t = makeToken({ sub: "5", role: "admin" });
    loginReturns(t);
    renderApp(ui);
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("5:admin"));
    expect(loadToken()).toBe(t);
  });

  it("test_login_sends_form_encoded", async () => {
    let body = "";
    server.use(
      http.post("/api/auth/login", async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ access_token: makeToken(), token_type: "bearer" });
      }),
    );
    renderApp(ui);
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(body).not.toBe(""));
    const p = new URLSearchParams(body);
    expect(p.get("username")).toBe("a@x.com");
    expect(p.get("password")).toBe("password1");
  });

  it("test_login_failure_leaves_no_token", async () => {
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ detail: "Incorrect" }, { status: 401 })));
    renderApp(ui);
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(loadToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("test_login_with_malformed_token_leaves_no_token", async () => {
    loginReturns("garbage");
    renderApp(ui);
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(sessionStorage.length).toBe(0));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("test_register_then_logs_in", async () => {
    server.use(
      http.post("/api/auth/register", () => HttpResponse.json({ id: 2, email: "n@x.com", role: "candidate" }, { status: 201 })),
    );
    loginReturns(makeToken({ sub: "2" }));
    renderApp(ui);
    await userEvent.click(screen.getByText("register"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("2:candidate"));
  });

  it("test_restores_user_from_session_storage", () => {
    saveToken(makeToken({ sub: "9" }));
    renderApp(ui);
    expect(screen.getByTestId("user")).toHaveTextContent("9:candidate");
  });

  it("test_logout_clears_token_cache_and_navigates", async () => {
    saveToken(makeToken());
    const { client } = renderApp(ui, { route: "/runs" });
    client.setQueryData(["1", "x"], "secret");
    await userEvent.click(screen.getByText("logout"));
    expect(loadToken()).toBeNull();
    expect(client.getQueryData(["1", "x"])).toBeUndefined();
    expect(screen.getByTestId("loc")).toHaveTextContent(/^\/login$/);
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("test_user_switch_clears_cache", async () => {
    saveToken(makeToken({ sub: "1" }));
    loginReturns(makeToken({ sub: "2", role: "admin" }));
    const { client } = renderApp(ui);
    client.setQueryData(["1", "candidates"], ["private"]);
    await userEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("2:admin"));
    expect(client.getQueryData(["1", "candidates"])).toBeUndefined();
  });

  it("test_expiry_timer_logs_out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const exp = Math.floor(Date.now() / 1000) + 60;
      saveToken(makeToken({ exp }));
      const { client } = renderApp(ui, { route: "/runs?x=1" });
      client.setQueryData(["1", "x"], 1);
      expect(screen.getByTestId("user")).toHaveTextContent("1:candidate");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(screen.getByTestId("user")).toHaveTextContent("none");
      expect(loadToken()).toBeNull();
      expect(client.getQueryData(["1", "x"])).toBeUndefined();
      expect(screen.getByTestId("loc").textContent).toBe(`/login?next=${encodeURIComponent("/runs?x=1")}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("test_expiry_timer_capped_and_cleaned_up", () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "setTimeout");
      saveToken(makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365 }));
      const { unmount } = renderApp(ui);
      const delays = spy.mock.calls.map((c) => c[1]).filter((d): d is number => typeof d === "number");
      expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
      const before = vi.getTimerCount();
      unmount();
      expect(vi.getTimerCount()).toBeLessThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
