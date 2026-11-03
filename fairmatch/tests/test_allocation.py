import itertools

import numpy as np
import pytest

from core.allocation import ALGORITHMS, gale_shapley, hungarian
from core.models import Candidate, Posting


def _cands(n):
    return [Candidate(f"c{i}", f"C{i}", "", (), 0, 0) for i in range(n)]


def _posts(caps):
    return [Posting(f"p{j}", f"P{j}", "", (), c) for j, c in enumerate(caps)]


def _total(alloc):
    return sum(a.score for a in alloc.assignments)


def test_hungarian_beats_greedy():
    scores = np.array([[0.9, 0.8], [0.85, 0.1]])
    cands, posts = _cands(2), _posts([1, 1])
    best = max(
        sum(scores[i, p[i]] for i in range(2)) for p in itertools.permutations(range(2))
    )
    alloc = hungarian(cands, posts, scores)
    assert alloc.algorithm == "hungarian"
    assert _total(alloc) == pytest.approx(best)
    assert best == pytest.approx(1.65)


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
def test_capacity_never_exceeded(fn):
    caps = [0, 1, 3]
    for seed in range(20):
        scores = np.random.default_rng(seed).random((8, 3))
        alloc = fn(_cands(8), _posts(caps), scores)
        for j, cap in enumerate(caps):
            assert sum(a.posting_id == f"p{j}" for a in alloc.assignments) <= cap
        ids = [a.candidate_id for a in alloc.assignments]
        assert len(ids) == len(set(ids))
        assert set(ids) | set(alloc.unallocated) == {f"c{i}" for i in range(8)}
        assert not set(ids) & set(alloc.unallocated)
        assert ids == sorted(ids, key=lambda s: int(s[1:]))


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
def test_more_candidates_than_seats_leaves_unallocated(fn):
    scores = np.random.default_rng(1).random((5, 2))
    alloc = fn(_cands(5), _posts([1, 1]), scores)
    assert len(alloc.assignments) == 2
    assert len(alloc.unallocated) == 3


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
def test_more_seats_than_candidates_leaves_seats_empty(fn):
    scores = np.random.default_rng(2).random((2, 2))
    alloc = fn(_cands(2), _posts([3, 3]), scores)
    assert len(alloc.assignments) == 2
    assert alloc.unallocated == ()


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
def test_zero_candidates_or_postings(fn):
    a = fn([], _posts([1]), np.zeros((0, 1)))
    assert a.assignments == () and a.unallocated == ()
    b = fn(_cands(2), [], np.zeros((2, 0)))
    assert b.assignments == () and b.unallocated == ("c0", "c1")
    c = fn(_cands(2), _posts([0, 0]), np.ones((2, 2)))
    assert c.assignments == () and c.unallocated == ("c0", "c1")


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
def test_ties_are_deterministic(fn):
    scores = np.full((4, 2), 0.5)
    first = fn(_cands(4), _posts([1, 1]), scores)
    for _ in range(5):
        assert fn(_cands(4), _posts([1, 1]), scores) == first
    assert [a.candidate_id for a in first.assignments] == ["c0", "c1"]
    assert [a.posting_id for a in first.assignments] == ["p0", "p1"]
    assert first.unallocated == ("c2", "c3")


def test_hungarian_matches_brute_force_with_capacity():
    caps = [2, 1]
    for seed in range(10):
        scores = np.random.default_rng(seed).random((4, 2))
        seats = [j for j, c in enumerate(caps) for _ in range(c)]
        best = max(
            sum(scores[i, seats[s]] for s, i in enumerate(p))
            for p in itertools.permutations(range(4), len(seats))
        )
        assert _total(hungarian(_cands(4), _posts(caps), scores)) == pytest.approx(best)


def test_gale_shapley_equals_hungarian_when_one_clear_winner():
    scores = np.array([[0.9, 0.1], [0.2, 0.8]])
    h = hungarian(_cands(2), _posts([1, 1]), scores)
    g = gale_shapley(_cands(2), _posts([1, 1]), scores)
    assert h.assignments == g.assignments
    assert g.algorithm == "gale_shapley"


def test_registry():
    assert ALGORITHMS == {"hungarian": hungarian, "gale_shapley": gale_shapley}


def test_tie_bonus_does_not_override_real_difference_at_scale():
    n = 1100
    s = np.eye(n) * 0.5
    s[0, n - 1] = 0.5
    s[n - 1, 0] = 0.500001
    alloc = hungarian(_cands(n), _posts([1] * n), s)
    assert _total(alloc) == pytest.approx(550.000001, abs=1e-9)


def test_hungarian_partial_tie_exact_output():
    scores = np.array([[1, 1, 0, 1], [1, 0, 0, 1]], dtype=float)
    alloc = hungarian(_cands(2), _posts([1, 1, 1, 1]), scores)
    assert [(a.candidate_id, a.posting_id) for a in alloc.assignments] == [
        ("c0", "p1"),
        ("c1", "p0"),
    ]


@pytest.mark.parametrize("fn", [hungarian, gale_shapley])
@pytest.mark.parametrize("bad", [np.nan, np.inf])
def test_non_finite_scores_rejected(fn, bad):
    with pytest.raises(ValueError):
        fn(_cands(1), _posts([1]), np.array([[bad]]))
