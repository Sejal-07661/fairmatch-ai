from collections.abc import Callable, Sequence

import numpy as np
from scipy.optimize import linear_sum_assignment

from core.models import Allocation, Assignment, Candidate, Posting


def _build(
    algorithm: str,
    candidates: Sequence[Candidate],
    postings: Sequence[Posting],
    scores: np.ndarray,
    pairs: dict[int, int],
) -> Allocation:
    assignments = tuple(
        Assignment(candidates[i].id, postings[j].id, float(scores[i, j]))
        for i, j in sorted(pairs.items())
    )
    unallocated = tuple(c.id for i, c in enumerate(candidates) if i not in pairs)
    return Allocation(algorithm, assignments, unallocated)


def _prepare(candidates, postings, scores) -> np.ndarray:
    scores = np.asarray(scores, dtype=float)
    if not np.all(np.isfinite(scores)):
        raise ValueError("scores must be finite (no NaN or inf)")
    if len(candidates) == 0 or len(postings) == 0:
        return scores.reshape(len(candidates), len(postings))
    if scores.shape != (len(candidates), len(postings)):
        raise ValueError(
            f"scores shape {scores.shape} does not match "
            f"({len(candidates)}, {len(postings)})"
        )
    return scores


def hungarian(
    candidates: Sequence[Candidate], postings: Sequence[Posting], scores: np.ndarray
) -> Allocation:
    scores = _prepare(candidates, postings, scores)
    seat_post = [j for j, p in enumerate(postings) for _ in range(max(p.capacity, 0))]
    n, s = len(candidates), len(seat_post)
    if n == 0 or s == 0:
        return _build("hungarian", candidates, postings, scores, {})
    expanded = scores[:, seat_post]
    # Tie-break: among equal-score optima, maximise sum of (n-i)*(s-c) over the
    # chosen (candidate i, seat c) pairs. Deterministic and favours low indices,
    # but not strictly lexicographic. The bonus is scaled so its total stays
    # below 1e-7, so it cannot override a real score difference of 1e-6.
    k = np.arange(min(n, s))
    span = float(np.sum((n - k) * (s - k)))
    bonus = (1e-7 / span) * np.outer(np.arange(n, 0, -1), np.arange(s, 0, -1))
    rows, cols = linear_sum_assignment(expanded + bonus, maximize=True)
    pairs = {int(r): seat_post[int(c)] for r, c in zip(rows, cols)}
    return _build("hungarian", candidates, postings, scores, pairs)


def gale_shapley(
    candidates: Sequence[Candidate], postings: Sequence[Posting], scores: np.ndarray
) -> Allocation:
    scores = _prepare(candidates, postings, scores)
    n, m = len(candidates), len(postings)
    if n == 0 or m == 0:
        return _build("gale_shapley", candidates, postings, scores, {})
    prefs = [sorted(range(m), key=lambda j, i=i: (-scores[i, j], j)) for i in range(n)]
    nxt = [0] * n
    held: list[list[int]] = [[] for _ in range(m)]
    free = list(range(n))
    while free:
        i = free.pop(0)
        while nxt[i] < m:
            j = prefs[i][nxt[i]]
            nxt[i] += 1
            cap = max(postings[j].capacity, 0)
            if cap == 0:
                continue
            held[j].append(i)
            if len(held[j]) <= cap:
                break
            worst = min(held[j], key=lambda k: (scores[k, j], -k))
            held[j].remove(worst)
            if worst != i:
                free.append(worst)
                break
        # candidate exhausted all postings: stays unallocated
    pairs = {i: j for j, members in enumerate(held) for i in members}
    return _build("gale_shapley", candidates, postings, scores, pairs)


ALGORITHMS: dict[str, Callable] = {
    "hungarian": hungarian,
    "gale_shapley": gale_shapley,
}
