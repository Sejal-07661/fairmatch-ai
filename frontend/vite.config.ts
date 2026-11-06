/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The API proxy target can be overridden (e.g. e2e runs use port 8765); default is unchanged.
export function resolveApiTarget(value: string | undefined): string {
  if (!value) return "http://127.0.0.1:8000";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_API_TARGET must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_API_TARGET must be an absolute http(s) URL");
  }
  return value;
}

export const apiTarget = resolveApiTarget(process.env.VITE_API_TARGET);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "vite.config.test.ts"],
    css: false,
    hookTimeout: 30_000,
  },
});
