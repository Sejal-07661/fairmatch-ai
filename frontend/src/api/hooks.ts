import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch, shouldRetry } from "./client";
import {
  parseRunFairness,
  parseRunMetrics,
  type Candidate,
  type Demographics,
  type Explanation,
  type Opportunity,
  type OpportunityIn,
  type Run,
  type RunAlgorithm,
  type RunSummary,
  type SimilarCandidate,
} from "./types";

export interface PageParams {
  limit: number;
  offset: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const POLL_MS = 1500;

function qs(p: PageParams): string {
  return `?limit=${p.limit}&offset=${p.offset}`;
}

function useUserId(): number | null {
  return useAuth().user?.userId ?? null;
}

interface AllPages<T> {
  items: T[];
  /** true when the 500-page safety cap was hit while the server still returned full pages */
  truncated: boolean;
}

async function fetchAll<T>(path: string, signal: AbortSignal): Promise<AllPages<T>> {
  const items: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await apiFetch<T[]>(`${path}${qs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })}`, { signal });
    items.push(...rows);
    if (rows.length < PAGE_SIZE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

function useAllPages<T>(resource: "candidates" | "opportunities", path: string) {
  const uid = useUserId();
  const query = useQuery({
    queryKey: [uid, resource, "all"],
    queryFn: ({ signal }) => fetchAll<T>(path, signal),
    enabled: uid !== null,
    retry: shouldRetry,
  });
  return { ...query, data: query.data?.items, truncated: query.data?.truncated ?? false };
}

function invalidate(qc: QueryClient, uid: number | null, ...parts: (string | number)[]) {
  return qc.invalidateQueries({ queryKey: [uid, ...parts] });
}

const validId = (id: number | null | undefined): id is number =>
  typeof id === "number" && Number.isInteger(id) && id > 0;

// ---- candidates ----
export function useMyCandidate() {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "candidates", "me"],
    queryFn: ({ signal }) => apiFetch<Candidate>("/candidates/me", { signal }),
    enabled: uid !== null,
    retry: shouldRetry,
  });
}

export function useCreateCandidate() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => apiFetch<Candidate>("/candidates", { method: "POST", body: form }),
    onSuccess: () => invalidate(qc, uid, "candidates"),
  });
}

export function useCandidates(page: PageParams) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "candidates", "list", page.limit, page.offset],
    queryFn: ({ signal }) => apiFetch<Candidate[]>(`/candidates${qs(page)}`, { signal }),
    enabled: uid !== null,
    retry: shouldRetry,
  });
}

export function useAllCandidates() {
  return useAllPages<Candidate>("candidates", "/candidates");
}

export function useCandidate(id: number | null) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "candidates", "detail", id],
    queryFn: ({ signal }) => apiFetch<Candidate>(`/candidates/${id}`, { signal }),
    enabled: uid !== null && validId(id),
    retry: shouldRetry,
  });
}

export function useDemographics(id: number | null) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "candidates", "demographics", id],
    queryFn: ({ signal }) => apiFetch<Demographics>(`/candidates/${id}/demographics`, { signal }),
    enabled: uid !== null && validId(id),
    retry: shouldRetry,
  });
}

export function useSetDemographics() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { candidateId: number; group_label: string }) =>
      apiFetch<Demographics>(`/candidates/${v.candidateId}/demographics`, {
        method: "PUT",
        json: { group_label: v.group_label },
      }),
    onSuccess: (_d, v) => invalidate(qc, uid, "candidates", "demographics", v.candidateId),
  });
}

// ---- opportunities ----
export function useOpportunities(page: PageParams) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "opportunities", "list", page.limit, page.offset],
    queryFn: ({ signal }) => apiFetch<Opportunity[]>(`/opportunities${qs(page)}`, { signal }),
    enabled: uid !== null,
    retry: shouldRetry,
  });
}

export function useAllOpportunities() {
  return useAllPages<Opportunity>("opportunities", "/opportunities");
}

export function useOpportunity(id: number | null) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "opportunities", "detail", id],
    queryFn: ({ signal }) => apiFetch<Opportunity>(`/opportunities/${id}`, { signal }),
    enabled: uid !== null && validId(id),
    retry: shouldRetry,
  });
}

export function useCreateOpportunity() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OpportunityIn) => apiFetch<Opportunity>("/opportunities", { method: "POST", json: body }),
    onSuccess: () => invalidate(qc, uid, "opportunities"),
  });
}

export function useSimilar(opportunityId: number | null, limit = 10) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "opportunities", "similar", opportunityId, limit],
    queryFn: ({ signal }) =>
      apiFetch<SimilarCandidate[]>(`/opportunities/${opportunityId}/similar-candidates?limit=${limit}`, { signal }),
    enabled: uid !== null && validId(opportunityId),
    retry: shouldRetry,
  });
}

// ---- runs ----
export function useRuns(page: PageParams) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "runs", "list", page.limit, page.offset],
    queryFn: ({ signal }) => apiFetch<RunSummary[]>(`/runs${qs(page)}`, { signal }),
    enabled: uid !== null,
    retry: shouldRetry,
  });
}

export function useRun(id: number | null) {
  const uid = useUserId();
  const query = useQuery({
    queryKey: [uid, "runs", "detail", id],
    queryFn: ({ signal }) => apiFetch<Run>(`/runs/${id}`, { signal }),
    enabled: uid !== null && validId(id),
    retry: shouldRetry,
    refetchInterval: (q) => {
      if (q.state.error instanceof ApiError && q.state.error.status === 404) return false;
      const status = q.state.data?.status;
      return status === "pending" || status === "running" ? POLL_MS : false;
    },
  });
  const run = query.data;
  const parsed = useMemo(
    () => (run ? { metrics: parseRunMetrics(run.metrics), fairness: parseRunFairness(run.fairness) } : undefined),
    [run],
  );
  return { ...query, parsed };
}

export function useStartRun() {
  const uid = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { algorithm: RunAlgorithm }) =>
      apiFetch<{ id: number; status: string }>("/runs", { method: "POST", json: v }),
    onSuccess: () => invalidate(qc, uid, "runs"),
  });
}

export function useExplanations(runId: number | null) {
  const uid = useUserId();
  return useQuery({
    queryKey: [uid, "runs", "explanations", runId],
    queryFn: ({ signal }) => apiFetch<Explanation[]>(`/runs/${runId}/explanations`, { signal }),
    enabled: uid !== null && validId(runId),
    retry: shouldRetry,
  });
}
