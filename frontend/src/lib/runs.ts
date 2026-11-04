import { useMemo } from "react";
import { useAllCandidates, useAllOpportunities } from "../api/hooks";
import { ALGORITHM_LABELS, ALGORITHM_NAMES, type AlgorithmName } from "../api/types";

export const allocKey = (algorithm: string, candidateId: number): string => `${algorithm}:${candidateId}`;

export function isAlgorithm(a: unknown): a is AlgorithmName {
  return a === "hungarian" || a === "gale_shapley";
}

export function algorithmLabel(a: string): string {
  return isAlgorithm(a) ? ALGORITHM_LABELS[a] : a === "both" ? "Both" : String(a);
}

/** Algorithms (in canonical order) that appear in a list of allocations and/or metrics. */
export function presentAlgorithms(allocs: { algorithm: string }[], metrics?: object): AlgorithmName[] {
  const seen = new Set<string>(allocs.map((a) => a.algorithm));
  return ALGORITHM_NAMES.filter((a) => seen.has(a) || (metrics !== undefined && (metrics as Record<string, unknown>)[a] != null));
}

export interface Names {
  candidate: (id: number) => string;
  opportunity: (id: number) => string;
  capacity: (id: number) => number | undefined;
  truncated: boolean;
  failed: boolean;
}

/** Resolves ids to display names; unknown ids fall back to "Candidate #id" / "Opportunity #id". */
export function useNames(): Names {
  const cands = useAllCandidates();
  const opps = useAllOpportunities();
  return useMemo(() => {
    const c = new Map<number, string>();
    for (const x of cands.data ?? []) if (typeof x.name === "string" && x.name !== "") c.set(x.id, x.name);
    const o = new Map<number, string>();
    const cap = new Map<number, number>();
    for (const x of opps.data ?? []) {
      if (typeof x.title === "string" && x.title !== "") o.set(x.id, x.title);
      if (typeof x.capacity === "number" && Number.isFinite(x.capacity)) cap.set(x.id, x.capacity);
    }
    return {
      candidate: (id) => c.get(id) ?? `Candidate #${id}`,
      opportunity: (id) => o.get(id) ?? `Opportunity #${id}`,
      capacity: (id) => cap.get(id),
      truncated: cands.truncated || opps.truncated,
      failed: cands.isError || opps.isError,
    };
  }, [cands.data, opps.data, cands.truncated, opps.truncated, cands.isError, opps.isError]);
}

export const NAMES_TRUNCATED_NOTE =
  "Only the first part of the candidate or opportunity list could be loaded, so some names below may show as ids.";
export const NAMES_FAILED_NOTE = "Names could not be loaded; showing ids instead.";
