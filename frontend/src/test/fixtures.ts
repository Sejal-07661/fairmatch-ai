import type { components } from "../api/schema";

type Schemas = components["schemas"];
export type Run = Schemas["RunOut"];
export type Allocation = Schemas["AllocationOut"];
export type Candidate = Schemas["CandidateOut"];
export type Opportunity = Schemas["OpportunityOut"];

export interface AlgorithmMetrics {
  total_score: number;
  blocking_pairs: number;
  runtime_ms: number;
  unallocated: number[];
}
export type Metrics = {
  fairness_skipped?: string;
  hungarian?: AlgorithmMetrics;
  gale_shapley?: AlgorithmMetrics;
};

export interface FairnessGroup {
  group: string;
  size: number;
  selected: number;
  selection_rate: number;
  mean_score: number;
}
export interface AlgorithmFairness {
  groups: FairnessGroup[];
  disparate_impact_ratio: number;
  passes_four_fifths: boolean;
  parity_difference: number;
}
export type Fairness = { hungarian?: AlgorithmFairness; gale_shapley?: AlgorithmFairness };

export function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    hungarian: { total_score: 4.2, blocking_pairs: 2, runtime_ms: 3.5, unallocated: [] },
    gale_shapley: { total_score: 4.0, blocking_pairs: 0, runtime_ms: 1.2, unallocated: [] },
    ...overrides,
  };
}

export function makeFairness(overrides: Partial<Fairness> = {}): Fairness {
  const algo = (): AlgorithmFairness => ({
    groups: [
      { group: "A", size: 10, selected: 5, selection_rate: 0.5, mean_score: 0.7 },
      { group: "B", size: 10, selected: 4, selection_rate: 0.4, mean_score: 0.65 },
    ],
    disparate_impact_ratio: 0.8,
    passes_four_fifths: true,
    parity_difference: 0.1,
  });
  return { hungarian: algo(), gale_shapley: algo(), ...overrides };
}

export function makeAllocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    algorithm: "hungarian",
    candidate_id: 1,
    opportunity_id: 1,
    score: 0.8,
    breakdown: {
      semantic: 0.4,
      skill_overlap: 0.2,
      experience: 0.1,
      education: 0.1,
      matched_skills: ["python"],
      related_skills: [["pandas", "numpy"]],
      total: 0.8,
    },
    reasons: ["Strong skill overlap"],
    narrative: "Good fit for the role.",
    used_fallback: true,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    algorithm: "both",
    status: "done",
    error: null,
    metrics: makeMetrics(),
    fairness: makeFairness(),
    created_at: "2026-11-04T10:00:00Z",
    finished_at: "2026-11-04T10:00:05Z",
    allocations: [makeAllocation()],
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    name: "Ada Lovelace",
    skills: ["python", "sql"],
    experience_years: 3,
    education_level: 2,
    used_fallback: false,
    ...overrides,
  };
}

export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 1,
    title: "Data Analyst",
    posting_text: "Analyse data with python and sql.",
    required_skills: ["python", "sql"],
    capacity: 2,
    min_experience_years: 1,
    min_education_level: 2,
    ...overrides,
  };
}
