import { z } from "zod";
import type { components } from "./schema";

type Schemas = components["schemas"];
export type Run = Schemas["RunOut"];
export type RunSummary = Schemas["RunSummaryOut"];
export type Allocation = Schemas["AllocationOut"];
export type Candidate = Schemas["CandidateOut"];
export type Opportunity = Schemas["OpportunityOut"];
export type OpportunityIn = Schemas["OpportunityIn"];
export type Demographics = Schemas["DemographicsOut"];
export type Explanation = Schemas["ExplanationOut"];
export type SimilarCandidate = Schemas["SimilarCandidateOut"];
export type RunAlgorithm = Schemas["RunIn"]["algorithm"];
export type RunStatus = "pending" | "running" | "done" | "failed";

export const ALGORITHM_NAMES = ["hungarian", "gale_shapley"] as const;
export type AlgorithmName = (typeof ALGORITHM_NAMES)[number];
export const ALGORITHM_LABELS: Record<AlgorithmName, string> = {
  hungarian: "Hungarian",
  gale_shapley: "Gale-Shapley",
};

const num = z.number().finite();

const AlgorithmMetrics = z.object({
  total_score: num,
  blocking_pairs: num,
  runtime_ms: num,
  unallocated: z.array(num),
});
export type AlgorithmMetrics = z.infer<typeof AlgorithmMetrics>;

export const RunMetrics = z.object({
  fairness_skipped: z.string().optional(),
  hungarian: AlgorithmMetrics.optional(),
  gale_shapley: AlgorithmMetrics.optional(),
});
export type RunMetrics = z.infer<typeof RunMetrics>;
export type Metrics = RunMetrics;

const FairnessGroup = z.object({
  group: z.string(),
  size: num,
  selected: num,
  selection_rate: num,
  mean_score: num,
});
export type FairnessGroup = z.infer<typeof FairnessGroup>;

const AlgorithmFairness = z.object({
  groups: z.array(FairnessGroup),
  disparate_impact_ratio: num,
  passes_four_fifths: z.boolean(),
  parity_difference: num,
});
export type AlgorithmFairness = z.infer<typeof AlgorithmFairness>;

export const RunFairness = z
  .object({
    hungarian: AlgorithmFairness.optional(),
    gale_shapley: AlgorithmFairness.optional(),
  })
  .nullable();
export type RunFairness = z.infer<typeof RunFairness>;
export type Fairness = NonNullable<RunFairness>;

export const ScoreBreakdown = z.object({
  semantic: num,
  skill_overlap: num,
  experience: num,
  education: num,
  matched_skills: z.array(z.string()),
  related_skills: z.array(z.tuple([z.string(), z.string()])),
  total: num,
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

function safeParser<T>(schema: z.ZodType<T>, what: string) {
  return (json: unknown): ParseResult<T> => {
    try {
      const r = schema.safeParse(json);
      if (r.success) return { ok: true, data: r.data };
      const issue = r.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      return { ok: false, error: `Invalid ${what}${where}` };
    } catch {
      return { ok: false, error: `Invalid ${what}` };
    }
  };
}

export const parseRunMetrics = safeParser(RunMetrics, "run metrics");
export const parseRunFairness = safeParser(RunFairness, "fairness data");
export const parseScoreBreakdown = safeParser(ScoreBreakdown, "score breakdown");
