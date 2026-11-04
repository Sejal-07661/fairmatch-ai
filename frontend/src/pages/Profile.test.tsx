import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "../auth/AuthContext";
import { saveToken } from "../auth/token";
import { makeCandidate } from "../test/fixtures";
import { makeToken, renderApp } from "../test/render";
import { server } from "../test/server";
import Profile from "./Profile";

function mount(role: "candidate" | "admin" = "candidate") {
  made = false;
  saveToken(makeToken({ role }));
  return renderApp(
    <AuthProvider>
      <Profile />
    </AuthProvider>,
  );
}

let made = false;
const none = () =>
  http.get("/api/candidates/me", () =>
    made ? HttpResponse.json(makeCandidate()) : HttpResponse.json({ detail: "No profile" }, { status: 404 }),
  );
const SUBMIT = { name: /submit|create|upload/i };

interface Captured {
  count: number;
  form: FormData | null;
}
function capturePost(res: () => Response | Promise<Response>): Captured {
  const c: Captured = { count: 0, form: null };
  server.use(
    http.post("/api/candidates", async ({ request }) => {
      c.count += 1;
      made = true;
      c.form = await request.formData();
      return res();
    }),
  );
  return c;
}

const created = (o = {}) => HttpResponse.json(makeCandidate(o), { status: 201 });

async function fillText(name = "Ada", text = "I know python") {
  await userEvent.type(await screen.findByLabelText(/^name/i), name);
  await userEvent.type(screen.getByLabelText(/resume text/i), text);
}

describe("Profile", () => {
  it("shows the form on 404 and posts multipart name + resume_text once", async () => {
    server.use(none());
    const c = capturePost(() => created());
    mount();
    await fillText();
    await userEvent.click(screen.getByRole("button", SUBMIT));
    await waitFor(() => expect(c.count).toBe(1));
    expect(c.form?.get("name")).toBe("Ada");
    expect(c.form?.get("resume_text")).toBe("I know python");
    expect(c.form?.has("resume")).toBe(false);
  });

  it("uploads a file", async () => {
    server.use(none());
    const c = capturePost(() => created());
    mount();
    await userEvent.type(await screen.findByLabelText(/^name/i), "Ada");
    const input = screen.getByLabelText(/resume file/i);
    expect(input).toHaveAttribute("accept", ".pdf,.docx,.txt");
    await userEvent.upload(input, new File(["hello"], "cv.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", SUBMIT));
    await waitFor(() => expect(c.count).toBe(1));
    expect((c.form?.get("resume") as File).size).toBe(5);
    expect(c.form?.has("resume_text")).toBe(false);
  });

  it("disables submit when invalid, at the 5 MiB boundary and for wrong suffixes", async () => {
    server.use(none());
    mount();
    const btn = await screen.findByRole("button", SUBMIT);
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^name/i), "Ada");
    const input = screen.getByLabelText(/resume file/i);
    await userEvent.upload(input, new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.pdf"), { applyAccept: false });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/File must be 5 MiB or smaller/)).toBeInTheDocument();
    await userEvent.upload(input, new File([new Uint8Array(5 * 1024 * 1024)], "a.pdf"), { applyAccept: false });
    expect(btn).toBeEnabled();
    await userEvent.upload(input, new File(["x"], "a.pdf.exe"), { applyAccept: false });
    expect(btn).toBeDisabled();
  });

  it("shows server 422 detail verbatim and keeps values", async () => {
    server.use(none());
    capturePost(() => HttpResponse.json({ detail: "Resume has no readable text" }, { status: 422 }));
    mount();
    await fillText("Grace", "some text");
    await userEvent.click(screen.getByRole("button", SUBMIT));
    const msg = await screen.findByText("Resume has no readable text");
    expect(msg.closest("[aria-live]")).not.toBeNull();
    expect(screen.getByLabelText(/^name/i)).toHaveValue("Grace");
    expect(screen.getByLabelText(/resume text/i)).toHaveValue("some text");
    expect(screen.getByRole("button", SUBMIT)).toBeEnabled();
  });

  it("double click sends exactly one request and shows a pending state", async () => {
    server.use(none());
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const c = capturePost(async () => {
      await gate;
      return created();
    });
    mount();
    await fillText();
    await userEvent.dblClick(screen.getByRole("button", SUBMIT));
    expect(await screen.findAllByText(/uploading/i)).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /uploading/i })).toBeDisabled();
    release();
    await screen.findByText("Ada Lovelace");
    expect(c.count).toBe(1);
  });

  it("keyboard-only submit with Enter is sent once even when spammed", async () => {
    server.use(none());
    const c = capturePost(() => created());
    mount();
    await screen.findByLabelText(/^name/i);
    await userEvent.tab();
    await userEvent.keyboard("Ada");
    await userEvent.tab();
    await userEvent.keyboard("python");
    await userEvent.tab(); // file input
    await userEvent.tab(); // submit
    await userEvent.keyboard("{Enter}{Enter}{Enter}");
    await screen.findByText("Ada Lovelace");
    expect(c.count).toBe(1);
  });

  it("switches to the profile view with skills after success", async () => {
    let made = false;
    server.use(
      http.get("/api/candidates/me", () =>
        made ? HttpResponse.json(makeCandidate()) : HttpResponse.json({ detail: "none" }, { status: 404 }),
      ),
    );
    capturePost(() => {
      made = true;
      return created();
    });
    mount();
    await fillText();
    await userEvent.click(screen.getByRole("button", SUBMIT));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText("sql")).toBeInTheDocument();
    expect(screen.getByText("Bachelor")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^name/i)).toBeNull();
  });

  it("409 refetches and shows the existing profile", async () => {
    let n = 0;
    server.use(
      http.get("/api/candidates/me", () =>
        n++ === 0
          ? HttpResponse.json({ detail: "none" }, { status: 404 })
          : HttpResponse.json(makeCandidate({ name: "Existing" })),
      ),
    );
    capturePost(() => HttpResponse.json({ detail: "Candidate profile already exists" }, { status: 409 }));
    mount();
    await fillText();
    await userEvent.click(screen.getByRole("button", SUBMIT));
    expect(await screen.findByText("Existing")).toBeInTheDocument();
  });

  it("renders skills and names as text with intact layout", async () => {
    const longName = "N".repeat(5000);
    const evil = "<img src=x onerror=alert(1)>";
    server.use(
      http.get("/api/candidates/me", () =>
        HttpResponse.json(makeCandidate({ name: longName, skills: [evil, "s".repeat(500)] })),
      ),
    );
    const { container } = mount();
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(longName).className).toMatch(/break-words/);
    expect(screen.getByText("s".repeat(500))).toHaveAttribute("title", "s".repeat(500));
    expect(screen.getByText(evil).className).toMatch(/truncate/);
  });

  it("shows the basic-mode notice when used_fallback", async () => {
    server.use(http.get("/api/candidates/me", () => HttpResponse.json(makeCandidate({ used_fallback: true }))));
    mount();
    expect(await screen.findByText(/basic mode \(no AI model was available\)/)).toBeInTheDocument();
  });

  it("shows no notice when not fallback, and Unknown for odd education", async () => {
    server.use(http.get("/api/candidates/me", () => HttpResponse.json(makeCandidate({ education_level: 9 }))));
    mount();
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText(/basic mode/)).toBeNull();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("admin sees a notice and link, no form, and makes no /candidates/me request", async () => {
    let hits = 0;
    server.use(
      http.get("/api/candidates/me", () => {
        hits += 1;
        return HttpResponse.json(makeCandidate());
      }),
    );
    mount("admin");
    expect(await screen.findByText("Admins manage candidates from the Candidates page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /candidates/i })).toHaveAttribute("href", "/candidates");
    expect(screen.queryByLabelText(/^name/i)).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(hits).toBe(0);
  });

  it("shows loading then error with retry", async () => {
    let n = 0;
    server.use(
      http.get("/api/candidates/me", () =>
        n++ === 0
          ? HttpResponse.json({ detail: "Database down" }, { status: 400 })
          : HttpResponse.json(makeCandidate()),
      ),
    );
    mount();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(await screen.findByText("Database down")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });
});
