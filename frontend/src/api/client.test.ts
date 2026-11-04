import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { makeToken } from "../test/render";
import { saveToken } from "../auth/token";
import { ApiError, apiFetch, bumpSession, setUnauthorizedHandler, shouldRetry } from "./client";

afterEach(() => setUnauthorizedHandler(() => {}));

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("apiFetch", () => {
  it("test_prefixes_api_and_attaches_bearer", async () => {
    const t = makeToken();
    saveToken(t);
    let auth: string | null = null;
    server.use(
      http.get("/api/things", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ ok: 1 });
      }),
    );
    await expect(apiFetch("/things")).resolves.toEqual({ ok: 1 });
    expect(auth).toBe(`Bearer ${t}`);
  });

  it("test_422_detail_becomes_api_error_detail", async () => {
    server.use(http.post("/api/x", () => HttpResponse.json({ detail: "bad name" }, { status: 422 })));
    const e = await failure(apiFetch("/x", { method: "POST", body: "{}" }));
    expect(e.status).toBe(422);
    expect(e.detail).toBe("bad name");
    expect(e.message).toBe("bad name");
  });

  it("test_401_calls_handler_once_and_throws", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(http.get("/api/x", () => HttpResponse.json({ detail: "expired" }, { status: 401 })));
    const e = await failure(apiFetch("/x"));
    expect(e.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("test_concurrent_401s_call_handler_once", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(http.get("/api/x", () => HttpResponse.json({ detail: "expired" }, { status: 401 })));
    const results = await Promise.allSettled([apiFetch("/x"), apiFetch("/x"), apiFetch("/x")]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    await failure(apiFetch("/x"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("test_stale_401_from_previous_session_is_ignored", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get("/api/slow", async () => {
        await gate;
        return HttpResponse.json({ detail: "expired" }, { status: 401 });
      }),
    );
    const p = failure(apiFetch("/slow"));
    bumpSession(); // user switched while the request was in flight
    release();
    const e = await p;
    expect(e.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("test_login_401_does_not_call_handler", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ detail: "Incorrect" }, { status: 401 })));
    const e = await failure(
      apiFetch("/auth/login", {
        method: "POST",
        body: new URLSearchParams({ username: "a", password: "b" }),
      }),
    );
    expect(e.detail).toBe("Incorrect");
    expect(handler).not.toHaveBeenCalled();
  });

  it("test_formdata_has_no_json_content_type", async () => {
    let ct: string | null = null;
    server.use(
      http.post("/api/up", ({ request }) => {
        ct = request.headers.get("content-type");
        return HttpResponse.json({});
      }),
    );
    const fd = new FormData();
    fd.append("name", "x");
    await apiFetch("/up", { method: "POST", body: fd });
    expect(ct).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("test_urlsearchparams_is_form_encoded", async () => {
    let ct: string | null = null;
    server.use(
      http.post("/api/f", ({ request }) => {
        ct = request.headers.get("content-type");
        return HttpResponse.json({});
      }),
    );
    await apiFetch("/f", { method: "POST", body: new URLSearchParams({ a: "1" }) });
    expect(ct).toMatch(/application\/x-www-form-urlencoded/);
  });

  it("test_json_body_gets_json_content_type", async () => {
    let ct: string | null = null;
    server.use(
      http.post("/api/j", ({ request }) => {
        ct = request.headers.get("content-type");
        return HttpResponse.json({});
      }),
    );
    await apiFetch("/j", { method: "POST", json: { a: 1 } });
    expect(ct).toBe("application/json");
  });

  it.each([
    ["non-json text", () => new HttpResponse("<html>boom</html>", { status: 500 })],
    ["empty body", () => new HttpResponse(null, { status: 502 })],
    ["json without detail", () => HttpResponse.json({ message: "x" }, { status: 500 })],
    ["non-string detail", () => HttpResponse.json({ detail: [{ msg: "x" }] }, { status: 422 })],
    ["null detail", () => HttpResponse.json({ detail: null }, { status: 500 })],
    ["json null", () => HttpResponse.json(null, { status: 500 })],
  ])("test_error_normalised_%s", async (_n, resp) => {
    server.use(http.get("/api/x", resp));
    const e = await failure(apiFetch("/x"));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.detail.length).toBeGreaterThan(0);
    expect(e.detail).not.toContain("<html>");
    expect(e.status).toBeGreaterThanOrEqual(400);
  });

  it("test_network_failure_is_status_0", async () => {
    server.use(http.get("/api/x", () => HttpResponse.error()));
    const e = await failure(apiFetch("/x"));
    expect(e.status).toBe(0);
    expect(e.detail.length).toBeGreaterThan(0);
  });

  it("test_success_with_bad_json_is_api_error", async () => {
    server.use(http.get("/api/x", () => new HttpResponse("nope", { status: 200 })));
    const e = await failure(apiFetch("/x"));
    expect(e.status).toBe(200);
  });

  it("test_204_resolves_undefined", async () => {
    server.use(http.get("/api/x", () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch("/x")).resolves.toBeUndefined();
  });

  it("test_parse_option_failure_is_api_error", async () => {
    server.use(http.get("/api/x", () => HttpResponse.json({ a: 1 })));
    const e = await failure(
      apiFetch("/x", {
        parse: () => {
          throw new Error("shape");
        },
      }),
    );
    expect(e).toBeInstanceOf(ApiError);
  });

  it("test_token_never_logged", async () => {
    saveToken(makeToken());
    server.use(http.get("/api/x", () => HttpResponse.json({ detail: "no" }, { status: 500 })));
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    await failure(apiFetch("/x"));
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });
});

describe("shouldRetry", () => {
  const e = (s: number) => new ApiError(s, "x");
  it.each([
    [0, e(0), true],
    [1, e(503), true],
    [2, e(503), false],
    [0, e(400), false],
    [0, e(401), false],
    [0, e(404), false],
    [0, e(422), false],
    [0, new Error("x"), false],
  ])("test_should_retry_%#", (n, err, expected) => {
    expect(shouldRetry(n, err)).toBe(expected);
  });
});
