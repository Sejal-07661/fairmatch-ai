import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

describe("App", () => {
  it("test_app_renders_login_when_signed_out", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("test_console_errors_fail_tests", () => {
    expect(() => console.error("boom")).toThrow(/console.error/);
    expect(() => console.warn("boom")).toThrow(/console.warn/);
  });
});
