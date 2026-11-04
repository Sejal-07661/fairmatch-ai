import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "../auth/AuthContext";
import { saveToken } from "../auth/token";
import { makeToken, renderApp } from "../test/render";
import { server } from "../test/server";
import ResumeForm from "./ResumeForm";

describe("ResumeForm", () => {
  it("calls onConflict on 409 and shows no error", async () => {
    saveToken(makeToken());
    server.use(http.post("/api/candidates", () => HttpResponse.json({ detail: "exists" }, { status: 409 })));
    const onConflict = vi.fn();
    renderApp(
      <AuthProvider>
        <ResumeForm onConflict={onConflict} />
      </AuthProvider>,
    );
    await userEvent.type(screen.getByLabelText(/^name/i), "Ada");
    await userEvent.type(screen.getByLabelText(/resume text/i), "python");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    await vi.waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("exists")).toBeNull();
  });

  it("starts disabled and validates", () => {
    saveToken(makeToken());
    renderApp(
      <AuthProvider>
        <ResumeForm onConflict={() => {}} />
      </AuthProvider>,
    );
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});
