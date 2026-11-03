from dataclasses import dataclass
from fractions import Fraction

from core.models import Allocation


@dataclass(frozen=True)
class GroupStats:
    group: str
    size: int
    selected: int
    selection_rate: float
    mean_score: float


@dataclass(frozen=True)
class FairnessReport:
    groups: tuple[GroupStats, ...]
    disparate_impact_ratio: float
    passes_four_fifths: bool
    parity_difference: float


def audit(allocation: Allocation, group_of: dict[str, str]) -> FairnessReport:
    """Selection-rate fairness metrics per group. Never divides by zero."""
    for cid in [a.candidate_id for a in allocation.assignments] + list(
        allocation.unallocated
    ):
        if cid not in group_of:
            raise KeyError(cid)

    sizes: dict[str, int] = {}
    for g in group_of.values():
        sizes[g] = sizes.get(g, 0) + 1
    scores: dict[str, list[float]] = {g: [] for g in sizes}
    for a in allocation.assignments:
        scores[group_of[a.candidate_id]].append(a.score)

    stats = []
    for g in sorted(sizes):
        size, sel = sizes[g], len(scores[g])
        stats.append(
            GroupStats(
                g,
                size,
                sel,
                sel / size if size else 0.0,
                sum(scores[g]) / sel if sel else 0.0,
            )
        )

    rates = [s.selection_rate for s in stats if s.size > 0]
    diff = max(rates) - min(rates) if rates else 0.0
    if len(rates) < 2 or max(rates) == 0:
        ratio = 1.0
    else:
        exact = [Fraction(s.selected, s.size) for s in stats if s.size > 0]
        ratio = float(min(exact) / max(exact))
    return FairnessReport(tuple(stats), ratio, ratio >= 0.8, diff)
