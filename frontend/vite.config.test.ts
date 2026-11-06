import { describe, expect, it } from "vitest";
import { resolveApiTarget } from "./vite.config";

describe("resolveApiTarget", () => {
  it("defaults to the local API", () => {
    expect(resolveApiTarget(undefined)).toBe("http://127.0.0.1:8000");
  });
  it("passes absolute http(s) URLs through", () => {
    expect(resolveApiTarget("http://api:8000")).toBe("http://api:8000");
  });
  it.each(["api:8000", "garbage", "ftp://x"])("rejects %s", (v) => {
    expect(() => resolveApiTarget(v)).toThrow("VITE_API_TARGET must be an absolute http(s) URL");
  });
});
