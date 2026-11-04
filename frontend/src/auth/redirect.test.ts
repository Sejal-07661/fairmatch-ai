import { homeFor, safeNext } from "./redirect";

describe("safeNext", () => {
  it.each([
    ["/runs", "/runs"],
    ["/runs/5?tab=x#top", "/runs/5?tab=x#top"],
    ["/ok?x=//evil", "/ok?x=//evil"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    ["/a/../runs", "/runs"],
  ])("accepts %s", (input, out) => {
    expect(safeNext(input)).toBe(out);
  });

  it.each([
    null,
    "",
    "//evil.com",
    "///evil.com",
    "http://evil.com",
    "https://evil.com/x",
    "javascript:alert(1)",
    "evil.com",
    " /ok",
    "/\\evil.com",
    "\\evil.com",
    "/.\\evil.com",
    "/\t/evil",
    "/ok\n//evil",
    "/.//evil.com",
    "/..//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "/.%2e//evil.com",
    "/%2E%2E//evil.com",
    "/%2e/%2e//evil.com",
    "/././/evil.com",
    "/a/b/../..//evil.com",
  ])("rejects %s", (input) => {
    expect(safeNext(input)).toBeNull();
  });

  it("test_home_for_role", () => {
    expect(homeFor("admin")).toBe("/runs");
    expect(homeFor("candidate")).toBe("/profile");
  });
});
