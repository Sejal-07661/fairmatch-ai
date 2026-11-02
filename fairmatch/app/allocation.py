"""
Allocation Module
------------------
This is the core "hard problem" of the project.

Given a fit score for every (candidate, posting) pair, and the fact that
each posting only has a limited number of seats, we cannot just give
every candidate their highest-scoring posting -- that would overload
popular postings and leave others empty.

Instead we treat this as an assignment problem and solve it using the
Hungarian Algorithm (via scipy.optimize.linear_sum_assignment), which
finds the overall best set of assignments given the constraints.

Each posting with capacity > 1 is represented as multiple "seats" so the
same algorithm naturally handles multi-seat postings.
"""

import numpy as np
from scipy.optimize import linear_sum_assignment


def allocate(candidates: list[dict], postings: list[dict], score_matrix: list[list[float]]) -> list[dict]:
    """
    candidates: list of parsed candidate dicts
    postings: list of parsed posting dicts (each has a 'capacity')
    score_matrix: 2D list, score_matrix[i][j] = fit score of candidate i for posting j

    Returns a list of allocation results: which candidate got which posting.
    """
    # Expand postings into individual seats so multi-seat postings work
    seat_to_posting = []
    for j, posting in enumerate(postings):
        for _ in range(posting["capacity"]):
            seat_to_posting.append(j)

    n_candidates = len(candidates)
    n_seats = len(seat_to_posting)

    # Build a cost matrix (Hungarian algorithm minimizes cost, we have scores
    # to maximize, so we negate). Pad with zeros if candidates != seats.
    size = max(n_candidates, n_seats)
    cost_matrix = np.zeros((size, size))

    for i in range(n_candidates):
        for seat_idx, posting_idx in enumerate(seat_to_posting):
            cost_matrix[i][seat_idx] = -score_matrix[i][posting_idx]

    row_ind, col_ind = linear_sum_assignment(cost_matrix)

    results = []
    for i, seat_idx in zip(row_ind, col_ind):
        if i >= n_candidates or seat_idx >= n_seats:
            continue  # padding row/column, not a real assignment
        posting_idx = seat_to_posting[seat_idx]
        results.append({
            "candidate": candidates[i]["name"],
            "posting": postings[posting_idx]["title"],
            "score": round(score_matrix[i][posting_idx], 3),
        })

    return results
