"""Grounded explanations: deterministic reasons, optional LLM narrative."""
from __future__ import annotations

from dataclasses import dataclass

from core.llm import LLMClient
from core.models import Candidate, Posting, ScoreBreakdown
from core.scoring import ScoreWeights


@dataclass(frozen=True)
class Explanation:
    candidate_id: str
    posting_id: str
    reasons: tuple[str, ...]
    narrative: str
    used_fallback: bool


def _build_reasons(bd: ScoreBreakdown, weights: ScoreWeights) -> tuple[str, ...]:
    matched = ", ".join(bd.matched_skills) if bd.matched_skills else "none"
    signals = (
        ("Semantic similarity", bd.semantic, weights.semantic, ""),
        ("Skill overlap", bd.skill_overlap, weights.skill, f" (matched: {matched})"),
        ("Experience", bd.experience, weights.experience, ""),
        ("Education", bd.education, weights.education, ""),
    )
    # Contributions use 4 decimals so they sum to the total within 1e-3.
    reasons = [
        f"{name} {value:.2f} x {w:g} = {value * w:.4f}{extra}"
        for name, value, w, extra in signals
    ]
    reasons += [f"Related skill: {a} is related to {b}" for a, b in bd.related_skills]
    return tuple(reasons)


def explain(
    breakdown: ScoreBreakdown,
    candidate: Candidate,
    posting: Posting,
    weights: ScoreWeights,
    llm: LLMClient | None = None,
) -> Explanation:
    reasons = _build_reasons(breakdown, weights)
    fallback = "; ".join(reasons) + "."
    narrative, used_fallback = fallback, True
    if llm is not None:
        prompt = (
            f"Write a short, neutral explanation of why {candidate.name} was "
            f"matched to the posting '{posting.title}', using only these facts:\n"
            + "\n".join(f"- {r}" for r in reasons)
        )
        try:
            text = llm.complete(prompt)
            if text and text.strip():
                narrative, used_fallback = text.strip(), False
        except Exception:  # noqa: BLE001, S110 - any LLM failure uses the fallback
            pass
    return Explanation(
        breakdown.candidate_id, breakdown.posting_id, reasons, narrative, used_fallback
    )
