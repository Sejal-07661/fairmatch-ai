import time
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from core.allocation import ALGORITHMS
from core.models import Allocation, Candidate, Posting


@dataclass(frozen=True)
class AlgorithmResult:
    allocation: Allocation
    total_score: float
    blocking_pairs: int
    runtime_ms: float


def count_blocking_pairs(
    allocation: Allocation,
    candidates: Sequence[Candidate],
    postings: Sequence[Posting],
    scores: np.ndarray,
) -> int:
    if len(candidates) == 0 or len(postings) == 0:
        return 0
    scores = np.asarray(scores, dtype=float)
    cidx = {c.id: i for i, c in enumerate(candidates)}
    pidx = {p.id: j for j, p in enumerate(postings)}
    current: dict[int, int] = {}
    members: list[list[int]] = [[] for _ in postings]
    for a in allocation.assignments:
        i, j = cidx[a.candidate_id], pidx[a.posting_id]
        current[i] = j
        members[j].append(i)
    count = 0
    for i in range(len(candidates)):
        for j, p in enumerate(postings):
            if p.capacity <= 0 or current.get(i) == j:
                continue
            if i in current and not scores[i, j] > scores[i, current[i]]:
                continue
            if len(members[j]) < p.capacity or (
                min(scores[k, j] for k in members[j]) < scores[i, j]
            ):
                count += 1
    return count


def compare_algorithms(
    candidates: Sequence[Candidate], postings: Sequence[Posting], scores: np.ndarray
) -> dict[str, AlgorithmResult]:
    results: dict[str, AlgorithmResult] = {}
    for name, fn in ALGORITHMS.items():
        start = time.perf_counter()
        alloc = fn(candidates, postings, scores)
        runtime_ms = (time.perf_counter() - start) * 1000.0
        results[name] = AlgorithmResult(
            allocation=alloc,
            total_score=float(sum(a.score for a in alloc.assignments)),
            blocking_pairs=count_blocking_pairs(alloc, candidates, postings, scores),
            runtime_ms=runtime_ms,
        )
    return results
