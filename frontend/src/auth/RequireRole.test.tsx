import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderApp, makeToken } from "../test/render";
import { saveToken } from "./token";
import { AuthProvider } from "./AuthContext";
import { RequireRole } from "./RequireRole";
import { server } from "../test/server";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function Tree({ role, onChild }: { role: "admin" | "candidate" | "any"; onChild?: () => void }) {
  return (
    <AuthProvider>
    <Routes>
      <Route
        path="/runs"
        element={
          <RequireRole role={role}>
            <Child onRender={onChild} />
          </RequireRole>
        }
      />
      <Route path="*" element={<Where />} />
    </Routes>
    </AuthProvider>
  );
}

function Child({ onRender }: { onRender?: (() => void) | undefined }) {
  onRender?.();
  return <h1>secret admin page</h1>;
}

describe("RequireRole", () => {
  it("test_signed_out_redirects_to_login_with_next", () => {
    renderApp(<Tree role="admin" />, { route: "/runs?page=2" });
    expect(screen.getByTestId("where").textContent).toBe(`/login?next=${encodeURIComponent("/runs?page=2")}`);
    expect(screen.queryByText("secret admin page")).toBeNull();
  });

  it("test_wrong_role_goes_to_forbidden_without_rendering_children", () => {
    saveToken(makeToken({ role: "candidate" }));
    const rendered = vi.fn();
    const requests = vi.fn();
    server.events.on("request:start", requests);
    renderApp(<Tree role="admin" onChild={rendered} />, { route: "/runs" });
    expect(screen.getByTestId("where")).toHaveTextContent("/forbidden");
    expect(rendered).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
    server.events.removeAllListeners();
  });

  it("test_admin_passes", () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<Tree role="admin" />, { route: "/runs" });
    expect(screen.getByText("secret admin page")).toBeInTheDocument();
  });

  it("test_any_accepts_both_roles", () => {
    saveToken(makeToken({ role: "candidate" }));
    renderApp(<Tree role="any" />, { route: "/runs" });
    expect(screen.getByText("secret admin page")).toBeInTheDocument();
  });

  it("test_admin_on_candidate_route_is_forbidden", () => {
    saveToken(makeToken({ role: "admin" }));
    renderApp(<Tree role="candidate" />, { route: "/runs" });
    expect(screen.getByTestId("where")).toHaveTextContent("/forbidden");
  });
});
