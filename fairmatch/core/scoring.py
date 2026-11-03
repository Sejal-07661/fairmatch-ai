"""Hybrid scoring: semantic similarity plus taxonomy-aware skill, experience, education."""
import math
from dataclasses import dataclass

import numpy as np

from core.embeddings import Embedder, cosine_matrix
from core.models import Candidate, Posting, ScoreBreakdown
from core.taxonomy import Taxonomy, get_taxonomy


@dataclass(frozen=True)
class ScoreWeights:
    semantic: float = 0.4
    skill: float = 0.4
    experience: float = 0.1
    education: float = 0.1

    def __post_init__(self):
        ws = (self.semantic, self.skill, self.experience, self.education)
        if not all(math.isfinite(w) for w in ws):
            raise ValueError("weights must be finite")
        if any(w < 0 for w in ws):
            raise ValueError("weights must be non-negative")
        if abs(sum(ws) - 1.0) > 1e-9:
            raise ValueError("weights must sum to 1.0")


def _norm(taxonomy: Taxonomy, s: str) -> str:
    return taxonomy.canonical(s) or s.strip().lower()


def skill_overlap(candidate_skills, required_skills, taxonomy):
    """Return (ratio, exact matches, related pairs (required, candidate_skill))."""
    if not required_skills:
        return 0.0, (), ()
    have = {_norm(taxonomy, s) for s in candidate_skills}
    credit = 0.0
    matched: list[str] = []
    related: list[tuple[str, str]] = []
    for req in required_skills:
        r = _norm(taxonomy, req)
        if r in have:
            credit += 1.0
            matched.append(req)
            continue
        close = sorted(have & taxonomy.related(r))
        if close:
            credit += 0.5
            related.append((req, close[0]))
    return credit / len(required_skills), tuple(matched), tuple(related)


def _experience(years: int, minimum: int) -> float:
    return 1.0 if minimum <= 0 else min(1.0, max(0, years) / minimum)


def _education(level: int, minimum: int) -> float:
    if minimum <= 0 or level >= minimum:
        return 1.0
    return max(0, level) / minimum


def score_matrix(
    candidates: list[Candidate],
    postings: list[Posting],
    embedder: Embedder,
    taxonomy: Taxonomy | None = None,
    weights: ScoreWeights | None = None,
) -> tuple[np.ndarray, list[list[ScoreBreakdown]]]:
    taxonomy = taxonomy or get_taxonomy()
    weights = weights or ScoreWeights()
    n_c, n_p = len(candidates), len(postings)
    matrix = np.zeros((n_c, n_p), dtype=float)
    if n_c == 0 or n_p == 0:
        return matrix, [[] for _ in range(n_c)]
    sims = cosine_matrix(
        embedder.encode([c.raw_text for c in candidates]),
        embedder.encode([p.raw_text for p in postings]),
    )
    sims = np.clip(np.nan_to_num(sims, nan=0.0), 0.0, 1.0)
    breakdowns: list[list[ScoreBreakdown]] = []
    for i, c in enumerate(candidates):
        row = []
        for j, p in enumerate(postings):
            ratio, matched, related = skill_overlap(c.skills, p.required_skills, taxonomy)
            sem = float(sims[i, j])
            exp = _experience(c.experience_years, p.min_experience_years)
            edu = _education(c.education_level, p.min_education_level)
            total = round(
                weights.semantic * sem + weights.skill * ratio
                + weights.experience * exp + weights.education * edu,
                6,
            )
            matrix[i, j] = total
            row.append(ScoreBreakdown(c.id, p.id, sem, ratio, exp, edu, matched, related, total))
        breakdowns.append(row)
    return matrix, breakdowns
