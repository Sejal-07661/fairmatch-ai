import { execFileSync } from "node:child_process";
import { request } from "@playwright/test";
import { ADMIN, BACKEND_URL } from "./helpers";

/**
 * Warms the embedding model inside the running API process (first load takes ~30 s) by creating
 * one throw-away opportunity, then removes it so the flows start from an empty database.
 */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: BACKEND_URL, timeout: 170_000 });
  try {
    const login = await api.post("/auth/login", { form: { username: ADMIN.email, password: ADMIN.password } });
    const { access_token } = (await login.json()) as { access_token: string };
    const res = await api.post("/opportunities", {
      headers: { Authorization: `Bearer ${access_token}` },
      data: {
        title: "warmup",
        posting_text: "Warm up the embedding model",
        capacity: 1,
        min_experience_years: 0,
        min_education_level: 0,
      },
    });
    if (!res.ok()) throw new Error(`warmup failed: ${res.status()} ${await res.text()}`);
  } finally {
    await api.dispose();
  }
  const python = process.env.E2E_PYTHON ?? "python";
  execFileSync(
    python,
    [
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('delete from opportunities'); c.commit(); c.close()",
      process.env.E2E_DB_PATH ?? "",
    ],
    { stdio: "inherit" },
  );
}
