import { clearToken, decodeToken, loadToken, saveToken } from "./token";
import { b64url, makeToken } from "../test/render";

const raw = (payload: string) => `${b64url("{}")}.${payload}.sig`;

describe("decodeToken", () => {
  it("test_decode_valid", () => {
    const exp = Math.floor(Date.now() / 1000) + 100;
    expect(decodeToken(makeToken({ sub: "7", role: "admin", exp }))).toEqual({
      userId: 7,
      role: "admin",
      exp,
    });
  });
  it("test_decode_base64url_and_unicode", () => {
    const t = makeToken({ x: "???>>>???", name: "José 日本 😀" });
    expect(t.split(".")[1]).toMatch(/[-_]/);
    expect(t.split(".")[1]).not.toMatch(/=/);
    expect(decodeToken(t)?.userId).toBe(1);
  });
  it.each([
    ["malformed base64", raw("@@@!!!")],
    ["non-json", raw(b64url("not json"))],
    ["json array", raw(b64url("[]"))],
    ["json null", raw(b64url("null"))],
    ["missing exp", raw(b64url(JSON.stringify({ sub: "1", role: "admin" })))],
    ["string exp", raw(b64url(JSON.stringify({ sub: "1", role: "admin", exp: "9" })))],
    ["role root", makeToken({ role: "root" })],
    ["role missing", makeToken({ role: undefined })],
    ["sub zero", makeToken({ sub: "0" })],
    ["sub negative", makeToken({ sub: "-3" })],
    ["sub float", makeToken({ sub: "1.5" })],
    ["sub non-numeric", makeToken({ sub: "abc" })],
    ["sub number type", makeToken({ sub: 1 })],
    ["only two parts", "a.b"],
    ["empty", ""],
  ])("test_decode_rejects_%s", (_name, token) => {
    expect(decodeToken(token)).toBeNull();
  });
});

describe("loadToken", () => {
  it("test_load_returns_saved_valid_token", () => {
    const t = makeToken();
    saveToken(t);
    expect(loadToken()).toBe(t);
  });
  it("test_load_clears_expired", () => {
    saveToken(makeToken({ exp: Math.floor(Date.now() / 1000) - 5 }));
    expect(loadToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it("test_load_clears_malformed", () => {
    saveToken("garbage");
    expect(loadToken()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it("test_never_uses_local_storage", () => {
    saveToken(makeToken());
    expect(localStorage.length).toBe(0);
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
