import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { makeClient, makeToken } from "../test/render";
import { saveToken } from "../auth/token";
import { AuthProvider } from "../auth/AuthContext";
import { makeCandidate, makeRun } from "../test/fixtures";
import {
  useAllCandidates,
  useCreateCandidate,
  useCreateOpportunity,
  useDemographics,
  useSetDemographics,
  useOpportunities,
  useRun,
  useStartRun,
} from "./hooks";

function wrapperFor(client = makeClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => saveToken(makeToken({ sub: "3", role: "admin" })));

describe("useAllCandidates", () => {
  it("test_pages_until_short_page", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/candidates", ({ request }) => {
        const u = new URL(request.url);
        seen.push(`${u.searchParams.get("limit")}:${u.searchParams.get("offset")}`);
        const off = Number(u.searchParams.get("offset"));
        const n = off === 0 ? 100 : off === 100 ? 100 : 30;
        return HttpResponse.json(Array.from({ length: n }, (_, i) => makeCandidate({ id: off + i + 1 })));
      }),
    );
    const { result } = renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.data).toHaveLength(230));
    expect(seen).toEqual(["100:0", "100:100", "100:200"]);
  });

  it("test_exact_multiple_fetches_one_more_empty_page", async () => {
    const seen: number[] = [];
    server.use(
      http.get("/api/candidates", ({ request }) => {
        const off = Number(new URL(request.url).searchParams.get("offset"));
        seen.push(off);
        return HttpResponse.json(off === 0 ? Array.from({ length: 100 }, (_, i) => makeCandidate({ id: i + 1 })) : []);
      }),
    );
    const { result } = renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.data).toHaveLength(100));
    expect(seen).toEqual([0, 100]);
  });

  it("test_query_keys_prefixed_by_user_id", async () => {
    server.use(http.get("/api/candidates", () => HttpResponse.json([])));
    const client = makeClient();
    const { result } = renderHook(() => useAllCandidates(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey[0]);
    expect(keys).toEqual([3]);
  });
});

describe("useOpportunities", () => {
  it("test_sends_limit_and_offset", async () => {
    let qs = "";
    server.use(
      http.get("/api/opportunities", ({ request }) => {
        qs = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useOpportunities({ limit: 25, offset: 50 }), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qs).toBe("?limit=25&offset=50");
  });
});

describe("mutations", () => {
  it("test_create_opportunity_invalidates_lists", async () => {
    let gets = 0;
    server.use(
      http.get("/api/opportunities", () => {
        gets += 1;
        return HttpResponse.json([]);
      }),
      http.post("/api/opportunities", () => HttpResponse.json({ id: 1 }, { status: 201 })),
    );
    const { result } = renderHook(() => ({ list: useOpportunities({ limit: 25, offset: 0 }), create: useCreateOpportunity() }), {
      wrapper: wrapperFor(),
    });
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => {
      await result.current.create.mutateAsync({
        title: "t",
        posting_text: "p",
        capacity: 1,
        min_experience_years: 0,
        min_education_level: 0,
      });
    });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("test_start_run_invalidates_runs", async () => {
    let gets = 0;
    server.use(
      http.get("/api/runs", () => {
        gets += 1;
        return HttpResponse.json([]);
      }),
      http.post("/api/runs", () => HttpResponse.json({ id: 9, status: "pending" }, { status: 202 })),
    );
    const { useRuns } = await import("./hooks");
    const { result } = renderHook(() => ({ list: useRuns({ limit: 25, offset: 0 }), start: useStartRun() }), {
      wrapper: wrapperFor(),
    });
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => {
      await result.current.start.mutateAsync({ algorithm: "both" });
    });
    await waitFor(() => expect(gets).toBe(2));
  });
});

const realSetTimeout = globalThis.setTimeout;
async function tick(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await new Promise((r) => realSetTimeout(r, 4));
  }
}

describe("useRun polling", () => {
  afterEach(() => vi.useRealTimers());

  function runHandler(statuses: string[], counter: { n: number; inflight: number; maxInflight: number }) {
    return http.get("/api/runs/5", async () => {
      counter.inflight += 1;
      counter.maxInflight = Math.max(counter.maxInflight, counter.inflight);
      const status = statuses[Math.min(counter.n, statuses.length - 1)] ?? "done";
      counter.n += 1;
      await new Promise((r) => setTimeout(r, 2000));
      counter.inflight -= 1;
      return HttpResponse.json(makeRun({ id: 5, status, metrics: status === "done" ? makeRun().metrics : null, fairness: null }));
    });
  }

  it("test_polls_every_1500ms_until_done_without_overlap", { timeout: 20000 }, async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const counter = { n: 0, inflight: 0, maxInflight: 0 };
    server.use(runHandler(["running", "running", "done"], counter));
    const { result } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    // first request takes 2s (longer than interval); polling must not overlap.
    await tick(10_000);
    expect(result.current.data?.status).toBe("done");
    const after = counter.n;
    expect(counter.maxInflight).toBe(1);
    expect(after).toBe(3);
    await tick(10_000);
    expect(counter.n).toBe(after);
  });

  it("test_exposes_parsed_blobs", async () => {
    server.use(http.get("/api/runs/5", () => HttpResponse.json(makeRun({ id: 5, metrics: { bad: 1 }, fairness: null }))));
    const { result } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.parsed).toBeDefined());
    expect(result.current.parsed?.metrics.ok).toBe(true);
    expect(result.current.parsed?.fairness).toEqual({ ok: true, data: null });
    expect(result.current.data?.id).toBe(5);
  });

  it("test_parsed_metrics_error_on_bad_blob", async () => {
    server.use(http.get("/api/runs/5", () => HttpResponse.json(makeRun({ id: 5, metrics: { hungarian: { total_score: "x" } } }))));
    const { result } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.parsed).toBeDefined());
    expect(result.current.parsed?.metrics.ok).toBe(false);
  });

  it("test_stops_on_failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json(makeRun({ id: 5, status: "failed", error: "boom", metrics: null, fairness: null }));
      }),
    );
    const { result } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await tick(10_000);
    expect(result.current.data?.status).toBe("failed");
    expect(n).toBe(1);
  });

  it("test_stops_on_404", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json({ detail: "Run not found" }, { status: 404 });
      }),
    );
    const { result } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await tick(10_000);
    expect(result.current.error).toMatchObject({ message: "Run not found" });
    expect(n).toBe(1);
  });

  it("test_stops_on_unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        return HttpResponse.json(makeRun({ id: 5, status: "running", metrics: null, fairness: null }));
      }),
    );
    const { result, unmount } = renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await tick(1600);
    expect(result.current.data?.status).toBe("running");
    expect(n).toBe(2);
    unmount();
    await tick(10_000);
    expect(n).toBe(2);
  });
});

describe("cache invalidation and caps", () => {
  it("test_set_demographics_refetches_demographics", async () => {
    let gets = 0;
    server.use(
      http.get("/api/candidates/7/demographics", () => {
        gets += 1;
        return HttpResponse.json({ candidate_id: 7, group_label: gets === 1 ? "A" : "B" });
      }),
      http.put("/api/candidates/7/demographics", () => HttpResponse.json({ candidate_id: 7, group_label: "B" })),
    );
    const { result } = renderHook(() => ({ d: useDemographics(7), set: useSetDemographics() }), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.d.data?.group_label).toBe("A"));
    await act(async () => {
      await result.current.set.mutateAsync({ candidateId: 7, group_label: "B" });
    });
    await waitFor(() => expect(result.current.d.data?.group_label).toBe("B"));
    expect(gets).toBe(2);
  });

  it("test_create_candidate_refetches_me", async () => {
    let gets = 0;
    server.use(
      http.get("/api/candidates/me", () => {
        gets += 1;
        return HttpResponse.json(makeCandidate());
      }),
      http.post("/api/candidates", () => HttpResponse.json(makeCandidate(), { status: 201 })),
    );
    const { useMyCandidate } = await import("./hooks");
    const { result } = renderHook(() => ({ me: useMyCandidate(), create: useCreateCandidate() }), { wrapper: wrapperFor() });
    await waitFor(() => expect(gets).toBe(1));
    await act(async () => {
      await result.current.create.mutateAsync(new FormData());
    });
    await waitFor(() => expect(gets).toBe(2));
  });

  it("test_use_all_sets_truncated_at_500_page_cap", { timeout: 60000 }, async () => {
    let n = 0;
    server.use(
      http.get("/api/candidates", () => {
        n += 1;
        return HttpResponse.json(Array.from({ length: 100 }, (_, i) => makeCandidate({ id: i + 1 })));
      }),
    );
    const { result } = renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 50000 });
    expect(n).toBe(500);
    expect(result.current.truncated).toBe(true);
    expect(result.current.data).toHaveLength(50000);
  });

  it("test_use_all_not_truncated_for_short_page", async () => {
    server.use(http.get("/api/candidates", () => HttpResponse.json([makeCandidate()])));
    const { result } = renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.truncated).toBe(false);
  });
});

describe("retry policy", () => {
  afterEach(() => vi.useRealTimers());

  it("test_query_5xx_retried_exactly_twice", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/candidates", () => {
        n += 1;
        return HttpResponse.json({ detail: "boom" }, { status: 500 });
      }),
    );
    renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await tick(20_000);
    expect(n).toBe(3);
  });

  it("test_query_4xx_never_retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/candidates", () => {
        n += 1;
        return HttpResponse.json({ detail: "no" }, { status: 403 });
      }),
    );
    renderHook(() => useAllCandidates(), { wrapper: wrapperFor() });
    await tick(20_000);
    expect(n).toBe(1);
  });

  it("test_mutation_5xx_not_retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.post("/api/runs", () => {
        n += 1;
        return HttpResponse.json({ detail: "queue down" }, { status: 503 });
      }),
    );
    const { result } = renderHook(() => useStartRun(), { wrapper: wrapperFor() });
    act(() => result.current.mutate({ algorithm: "both" }));
    await tick(20_000);
    expect(n).toBe(1);
  });

  it("test_polling_stops_when_running_run_then_404", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let n = 0;
    server.use(
      http.get("/api/runs/5", () => {
        n += 1;
        if (n === 1) return HttpResponse.json(makeRun({ id: 5, status: "running", metrics: null, fairness: null }));
        return HttpResponse.json({ detail: "Run not found" }, { status: 404 });
      }),
    );
    renderHook(() => useRun(5), { wrapper: wrapperFor() });
    await tick(15_000);
    expect(n).toBe(2);
  });
});
