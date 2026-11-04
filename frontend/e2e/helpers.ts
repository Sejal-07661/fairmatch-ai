import { expect, request, test as base, type APIRequestContext, type Page } from "@playwright/test";

export const BACKEND_URL = "http://127.0.0.1:8765";
export const ADMIN = { email: "admin@example.com", password: "E2e-Passw0rd!" };
export const PASSWORD = "Cand-Passw0rd!";

export const RESUME_TEXT =
  "Skills: Python, SQL, Docker, AWS.\n4 years of experience building data pipelines.\nBachelor of Science in Computer Science.";

/** 404s the UI legitimately provokes ("no profile yet", "demographics not set"). */
function isExpected404(url: string): boolean {
  return /\/api\/(candidates\/me|candidates\/\d+\/demographics)$/.test(new URL(url).pathname);
}

/** Shared fixture: fails any test that sees console.error, a page error or a 5xx response. */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const loc = m.location().url;
        if (m.text().includes("status of 404") && loc && isExpected404(loc)) return;
        problems.push(`console.error: ${m.text()} (${loc})`);
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
      });
      await use();
      expect(problems, "browser problems").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function newApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BACKEND_URL, timeout: 100_000 });
}

export async function apiLogin(api: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await api.post("/auth/login", { form: { username: email, password } });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function apiRegisterCandidate(
  api: APIRequestContext,
  email: string,
  name: string,
  text = RESUME_TEXT,
): Promise<{ token: string; id: number }> {
  const reg = await api.post("/auth/register", { data: { email, password: PASSWORD } });
  expect(reg.status(), await reg.text()).toBe(201);
  const token = await apiLogin(api, email, PASSWORD);
  const r = await api.post("/candidates", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { name, resume_text: text },
  });
  expect(r.status(), await r.text()).toBe(201);
  return { token, id: ((await r.json()) as { id: number }).id };
}

export async function apiStartRun(api: APIRequestContext, token: string, algorithm: string): Promise<number> {
  const r = await api.post("/runs", { headers: { Authorization: `Bearer ${token}` }, data: { algorithm } });
  expect(r.status(), await r.text()).toBe(202);
  return ((await r.json()) as { id: number }).id;
}

export async function uiLogin(page: Page, email: string, password: string, path = "/login"): Promise<void> {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function uiRegister(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/profile$/);
}

export async function uiSignOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
