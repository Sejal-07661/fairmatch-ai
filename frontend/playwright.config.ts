import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Ports are fixed on purpose: 8000 is NOT used (it may belong to an unrelated program).
export const BACKEND_PORT = 8765;
export const FRONTEND_PORT = 5173;
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

// Local default Chromium (documented in e2e/README.md). Override with E2E_CHROMIUM_PATH.
const LOCAL_DEFAULT_CHROMIUM = path.join(
  process.env.LOCALAPPDATA ?? "",
  "ms-playwright",
  "chromium-1248",
  "chrome-win64",
  "chrome.exe",
);
if (process.env.E2E_CHROMIUM_PATH && !existsSync(process.env.E2E_CHROMIUM_PATH)) {
  throw new Error(`E2E_CHROMIUM_PATH is set but the file does not exist: ${process.env.E2E_CHROMIUM_PATH}`);
}
const chromiumPath = process.env.E2E_CHROMIUM_PATH ?? LOCAL_DEFAULT_CHROMIUM;
// Unset variable and missing local default: fall back to Playwright's own browser (fails explicitly if absent).
const executablePath = existsSync(chromiumPath) ? chromiumPath : undefined;

// One temp dir per run, shared with workers and global setup/teardown through the environment.
if (!process.env.FAIRMATCH_E2E_INTERNAL_DIR) {
  process.env.FAIRMATCH_E2E_INTERNAL_DIR = mkdtempSync(path.join(tmpdir(), "fairmatch-e2e-"));
  const dir = process.env.FAIRMATCH_E2E_INTERNAL_DIR;
  // Safety net: the backend still holds the SQLite file when global teardown runs (Windows).
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // best effort
    }
  });
}
const dbPath = path.join(process.env.FAIRMATCH_E2E_INTERNAL_DIR, "e2e.db");
process.env.E2E_DB_PATH = dbPath;
delete process.env.OPENAI_API_KEY;

const python = process.env.E2E_PYTHON ?? "python";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: path.join(process.env.FAIRMATCH_E2E_INTERNAL_DIR, "results"),
  use: {
    baseURL: FRONTEND_URL,
    launchOptions: executablePath ? { executablePath } : {},
    trace: "off",
  },
  webServer: [
    {
      // Creates the tables and the admin, then serves the API. Never port 8000.
      command: `${python} scripts/e2e_prepare.py "${dbPath}" && ${python} -m uvicorn api.main:create_app --factory --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: "../fairmatch",
      url: `${BACKEND_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        JWT_SECRET: "e2e-secret",
        DATABASE_URL: `sqlite:///${dbPath.replaceAll("\\", "/")}`,
        CELERY_EAGER: "true",
        REDIS_URL: "fakeredis://",
        HF_HUB_OFFLINE: "1",
        PYTHONIOENCODING: "utf-8",
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_TARGET: BACKEND_URL },
    },
  ],
});
