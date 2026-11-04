import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useLocation } from "react-router-dom";
import { server } from "../test/server";
import { makeToken, renderApp } from "../test/render";
import { AuthProvider } from "../auth/AuthContext";
import Register from "./Register";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

describe("Register", () => {
  const ui = (
    <AuthProvider>
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="*" element={<Where />} />
    </Routes>
    </AuthProvider>
  );

  it("test_heading_and_password_hint", () => {
    renderApp(ui, { route: "/register" });
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "8");
  });

  it("test_registers_then_lands_on_profile", async () => {
    server.use(
      http.post("/api/auth/register", () => HttpResponse.json({ id: 1, email: "a@x.com", role: "candidate" }, { status: 201 })),
      http.post("/api/auth/login", () => HttpResponse.json({ access_token: makeToken(), token_type: "bearer" })),
    );
    renderApp(ui, { route: "/register" });
    await userEvent.type(screen.getByLabelText("Email"), "a@x.com");
    await userEvent.type(screen.getByLabelText("Password"), "password1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/profile"));
  });

  it("test_shows_server_detail", async () => {
    server.use(http.post("/api/auth/register", () => HttpResponse.json({ detail: "Email already registered" }, { status: 409 })));
    renderApp(ui, { route: "/register" });
    await userEvent.type(screen.getByLabelText("Email"), "a@x.com");
    await userEvent.type(screen.getByLabelText("Password"), "password1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered");
  });
});
