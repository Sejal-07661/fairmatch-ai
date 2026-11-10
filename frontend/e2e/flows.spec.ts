import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN,
  PASSWORD,
  RESUME_TEXT,
  apiLogin,
  apiRegisterCandidate,
  apiStartRun,
  expect,
  newApi,
  test,
  uiLogin,
  uiRegister,
  uiSignOut,
} from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALICE = { email: "alice@example.com", name: "Alice Candidate" };
const BOB = { email: "bob@example.com", name: "Bob Candidate" };

test.describe.configure({ mode: "serial" });

test("1. candidates register and upload text and a real PDF", async ({ page }) => {
  await uiRegister(page, ALICE.email, PASSWORD);
  await page.getByLabel("Name", { exact: true }).fill(ALICE.name);
  await page.getByLabel("Resume text").fill(RESUME_TEXT);
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByRole("heading", { name: ALICE.name })).toBeVisible();
  const skills = page.getByRole("list", { name: "Skills" });
  await expect(skills.getByRole("listitem").first()).toBeVisible();
  await expect(skills.getByText(/python/i).first()).toBeVisible();
  await uiSignOut(page);

  await uiRegister(page, BOB.email, PASSWORD);
  await page.getByLabel("Name", { exact: true }).fill(BOB.name);
  await page.getByLabel(/Resume file/).setInputFiles(path.join(here, "fixtures", "resume.pdf"));
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.getByRole("heading", { name: BOB.name })).toBeVisible();
  await expect(page.getByRole("list", { name: "Skills" }).getByRole("listitem").first()).toBeVisible();
});

test("2. admin creates opportunities, sets demographics, runs both and reviews results", async ({ page }) => {
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/opportunities");
  const opps = [
    ["Data Engineer", "Build Python and SQL data pipelines on AWS.", "2"],
    ["Backend Developer", "Python services with Docker.", "1"],
    ["Analyst", "SQL reporting and dashboards.", "1"],
  ];
  for (const [title, text, cap] of opps) {
    await page.getByLabel("Title").fill(title ?? "");
    await page.getByLabel("Posting text").fill(text ?? "");
    await page.getByLabel("Capacity").fill(cap ?? "1");
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await expect(page.getByRole("link", { name: `View ${title}` })).toBeVisible();
  }

  for (const [name, group] of [
    [ALICE.name, "Group A"],
    [BOB.name, "Group B"],
  ]) {
    await page.goto("/candidates");
    await page.getByRole("link", { name: `View ${name}` }).click();
    await page.getByLabel("Group label").fill(group ?? "");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }

  const demoRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/demographics")) demoRequests.push(r.url());
  });
  await page.goto("/runs");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByRole("tab", { name: "Results" })).toBeVisible({ timeout: 90_000 });

  await expect(page.getByRole("cell", { name: /^\d+ \/ \d+$/ }).first()).toBeVisible();
  const seats = await page.getByRole("cell", { name: /^\d+ \/ \d+$/ }).allTextContents();
  expect(seats.length).toBeGreaterThan(0);
  for (const s of seats) {
    const [used, cap] = s.split("/").map((n) => Number(n.trim()));
    expect(used).toBeLessThanOrEqual(cap ?? 0);
  }

  await page.getByRole("tab", { name: "Comparison" }).click();
  const legend = page.getByRole("list", { name: "Legend" }).first();
  await expect(legend.getByText("Hungarian")).toBeVisible();
  await expect(legend.getByText("Gale-Shapley")).toBeVisible();

  await page.getByRole("tab", { name: "Fairness" }).click();
  const panel = page.getByRole("group", { name: "Disparate impact: Hungarian" });
  await expect(panel).toBeVisible();
  const text = (await panel.textContent()) ?? "";
  const ratio = Number(/(\d\.\d{3})/.exec(text)?.[1]);
  expect(Number.isFinite(ratio)).toBe(true);
  await expect(panel.getByText(ratio >= 0.8 ? "Passes four-fifths rule" : "Fails four-fifths rule")).toBeVisible();

  await page.getByRole("tab", { name: "Explanations" }).click();
  await page.getByRole("button", { name: /^Explain / }).first().click();
  const region = page.getByRole("region", { name: "Explanation" });
  await expect(region).toBeVisible();
  await expect(region.locator('[aria-label$="of 1.00"]').first()).toBeVisible();
  await expect(region).not.toContainText("Group A");
  await expect(region).not.toContainText("Group B");
  expect(demoRequests).toEqual([]);
});

test("3. a run with missing demographics shows the exact reason", async ({ page }) => {
  const api = await newApi();
  await apiRegisterCandidate(api, "carol@example.com", "Carol Candidate");
  await api.dispose();
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/runs");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByRole("tab", { name: "Fairness" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("tab", { name: "Fairness" }).click();
  await expect(page.getByText("demographics missing for 1 of 3 candidates").first()).toBeVisible();
  const trail = page.getByRole("region", { name: "Audit trail" });
  await expect(trail).toContainText(ADMIN.email);
  await expect(trail).toContainText("demographics missing for 1 of 3 candidates");
  await expect(trail).not.toContainText("Invalid Date");
});

test("4. a candidate cannot open /runs and no /api/runs request is made", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/runs")) seen.push(r.url());
  });
  await uiLogin(page, ALICE.email, PASSWORD);
  await expect(page).toHaveURL(/\/profile/);
  await page.goto("/runs");
  await expect(page.getByRole("heading", { name: "Forbidden" })).toBeVisible();
  expect(seen).toEqual([]);
});

test("5. an invalid or expired token lands on /login with next preserved, without a loop", async ({ browser }) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const expired = `${b64({ alg: "HS256" })}.${b64({ sub: "1", role: "admin", exp: 1000 })}.sig`;
  for (const token of ["not-a-jwt", expired]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((t) => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        sessionStorage.setItem("fairmatch.token", t);
      }
    }, token);
    await page.goto("http://127.0.0.1:5173/runs/3");
    await expect(page).toHaveURL(/\/login\?next=%2Fruns%2F3$/);
    const url = page.url();
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(url);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await context.close();
  }
});

test("6. hostile names and text render as text", async ({ page }) => {
  const hostile = '<img src=x onerror="window.__xss=1">';
  const api = await newApi();
  await apiRegisterCandidate(
    api,
    "mallory@example.com",
    hostile,
    'Skills: Python, <script>window.__xss=1</script>, <svg onload="window.__xss=1">.\n3 years of experience.',
  );
  await api.dispose();

  await uiLogin(page, "mallory@example.com", PASSWORD);
  await expect(page.getByRole("heading", { name: hostile })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await uiSignOut(page);

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/candidates");
  await expect(page.getByText(hostile).first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("7. runs list paginates newest first with valid timestamps", async ({ page }) => {
  test.setTimeout(300_000);
  const api = await newApi();
  const token = await apiLogin(api, ADMIN.email, ADMIN.password);
  let last = 0;
  for (let i = 0; i < 26; i++) last = await apiStartRun(api, token, "hungarian");
  await api.dispose();

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/runs");
  const links = page.getByRole("link", { name: /^Run \d+$/ });
  await expect(links).toHaveCount(25);
  expect(await links.first().textContent()).toBe(`Run ${last}`);
  const lastOnPage1 = Number(/\d+/.exec((await links.last().textContent()) ?? "")?.[0]);
  await expect(page.locator("body")).not.toContainText("Invalid Date");

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(links.first()).not.toHaveText(`Run ${last}`);
  expect(Number(/\d+/.exec((await links.first().textContent()) ?? "")?.[0])).toBeLessThan(lastOnPage1);
  await expect(page.locator("body")).not.toContainText("Invalid Date");
});
