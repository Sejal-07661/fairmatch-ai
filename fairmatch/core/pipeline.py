"""End-to-end pipeline: parse -> embed/score -> allocate -> audit -> explain."""
from __future__ import annotations

from dataclasses import dataclass

from core.compare import AlgorithmResult, compare_algorithms
from core.embeddings import Embedder, SentenceTransformerEmbedder
from core.explain import Explanation, explain
from core.fairness import FairnessReport, audit
from core.llm import LLMClient, get_llm_client
from core.models import Candidate, Posting, ScoreBreakdown
from core.parser import parse_candidate, parse_posting
from core.scoring import ScoreWeights, score_matrix


@dataclass(frozen=True)
class PipelineResult:
    candidates: list[Candidate]
    postings: list[Posting]
    breakdowns: list[list[ScoreBreakdown]]
    results: dict[str, AlgorithmResult]
    explanations: dict[str, tuple[Explanation, ...]]
    fairness: dict[str, FairnessReport] | None


def run_pipeline(
    candidates_in: list[dict],
    postings_in: list[dict],
    group_of: dict[str, str] | None = None,
    embedder: Embedder | None = None,
    llm: LLMClient | None = None,
    weights: ScoreWeights | None = None,
) -> PipelineResult:
    """Run the full matching pipeline. Ids are generated as c1.. / p1.. in input order.

    group_of is keyed by the generated candidate ids (c1..cN, input order), not
    by name. Ids in group_of that match no candidate raise ValueError (stale ids
    would silently inflate group sizes), including any non-empty group_of with
    zero candidates.

    Empty candidates, postings or zero capacity yield a valid result with no
    assignments. If group_of lacks a label for any candidate in an allocation,
    the audit's KeyError (naming the id) propagates; it is deliberately not
    swallowed. LLM failures never crash: parsing and explanation fall back.
    """
    weights = weights or ScoreWeights()
    embedder = embedder or SentenceTransformerEmbedder()
    llm = llm if llm is not None else get_llm_client()

    candidates = [
        parse_candidate(f"c{i}", c["name"], c["resume_text"], llm=llm)
        for i, c in enumerate(candidates_in, 1)
    ]
    postings = [
        parse_posting(f"p{i}", p["title"], p["posting_text"], p["capacity"], llm=llm)
        for i, p in enumerate(postings_in, 1)
    ]
    scores, breakdowns = score_matrix(candidates, postings, embedder, weights=weights)
    results = compare_algorithms(candidates, postings, scores)

    if group_of is not None:
        stale = sorted(set(group_of) - {c.id for c in candidates})
        if stale:
            raise ValueError(f"group_of has ids not in candidates: {stale}")

    cidx = {c.id: i for i, c in enumerate(candidates)}
    pidx = {p.id: j for j, p in enumerate(postings)}
    cache: dict[tuple[str, str], Explanation] = {}

    def _explain(a):
        key = (a.candidate_id, a.posting_id)
        if key not in cache:
            cache[key] = explain(
                breakdowns[cidx[a.candidate_id]][pidx[a.posting_id]],
                candidates[cidx[a.candidate_id]],
                postings[pidx[a.posting_id]],
                weights,
                llm,
            )
        return cache[key]

    explanations = {
        name: tuple(_explain(a) for a in r.allocation.assignments)
        for name, r in results.items()
    }
    fairness = (
        {name: audit(r.allocation, group_of) for name, r in results.items()}
        if group_of is not None
        else None
    )
    return PipelineResult(candidates, postings, breakdowns, results, explanations, fairness)



