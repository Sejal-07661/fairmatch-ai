import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { server } from "./server";

// Collected (not thrown): MSW swallows an error thrown inside its handlers and answers the app with a 500.
const unhandled: string[] = [];
const consoleCalls: string[] = [];

beforeAll(() =>
  server.listen({
    onUnhandledRequest(req) {
      unhandled.push(`${req.method} ${req.url}`);
    },
  }),
);

beforeEach(() => {
  unhandled.length = 0;
  consoleCalls.length = 0;
  const record =
    (level: "error" | "warn") =>
    (...args: unknown[]) => {
      consoleCalls.push(`console.${level}: ${args.map(String).join(" ")}`);
    };
  vi.spyOn(console, "error").mockImplementation(record("error"));
  vi.spyOn(console, "warn").mockImplementation(record("warn"));
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  const problems = [...unhandled.map((u) => `unhandled request: ${u}`), ...consoleCalls];
  unhandled.length = 0;
  consoleCalls.length = 0;
  expect(problems).toEqual([]);
});

afterAll(() => server.close());
