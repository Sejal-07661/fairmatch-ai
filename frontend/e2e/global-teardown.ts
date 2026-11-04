import { realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Best effort: the API may still hold the SQLite file open; playwright.config.ts retries on exit. */
export default function globalTeardown(): void {
  const dir = process.env.FAIRMATCH_E2E_INTERNAL_DIR;
  if (!dir) return;
  // Only ever delete a directory this suite created under the OS temp dir.
  if (
    path.dirname(realpathSync(dir)) !== realpathSync(tmpdir()) ||
    !path.basename(dir).startsWith("fairmatch-e2e-")
  ) {
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // removed again when the runner exits, after the servers have stopped
  }
}
