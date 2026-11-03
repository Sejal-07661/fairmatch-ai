import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

beforeEach(() => {
  const fail =
    (level: "error" | "warn") =>
    (...args: unknown[]) => {
      throw new Error(`console.${level} called during test: ${args.map(String).join(" ")}`);
    };
  vi.spyOn(console, "error").mockImplementation(fail("error"));
  vi.spyOn(console, "warn").mockImplementation(fail("warn"));
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

afterAll(() => server.close());
