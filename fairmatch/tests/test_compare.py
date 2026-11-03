import numpy as np

from core.allocation import ALGORITHMS
from core.compare import AlgorithmResult, compare_algorithms, count_blocking_pairs
from core.models import Allocation, Assignment, Candidate, Posting


def _cands(n):
    return [Candidate(f"c{i}", f"C{i}", "", (), 0, 0) for i in range(n)]


def _posts(caps):
    return [Posting(f"p{j}", f"P{j}", "", (), cap) for j, cap in enumerate(caps)]


def _cases():
    for seed in range(20):
        rng = np.random.default_rng(seed)
        n, m = int(rng.integers(1, 9)), int(rng.integers(1, 5))
        caps = [int(x) for x in rng.integers(0, 4, size=m)]
        yield _cands(n), _posts(caps), rng.random((n, m))


def test_gale_shapley_has_zero_blocking_pairs():
    for cands, posts, scores in _cases():
        res = compare_algorithms(cands, posts, scores)
        assert res["gale_shapley"].blocking_pairs == 0


def test_hungarian_total_at_least_gale_shapley_total():
    for cands, posts, scores in _cases():
        res = compare_algorithms(cands, posts, scores)
        assert res["hungarian"].total_score >= res["gale_shapley"].total_score - 1e-9


def test_blocking_pair_detected():
    cands, posts = _cands(2), _posts([1, 1])
    scores = np.array([[0.9, 0.1], [0.8, 0.2]])
    # c0 -> p1, c1 -> p0: c0 prefers p0 and beats c1 there.
    alloc = Allocation(
        "x", (Assignment("c0", "p1", 0.1), Assignment("c1", "p0", 0.8)), ()
    )
    assert count_blocking_pairs(alloc, cands, posts, scores) == 1


def test_unallocated_and_free_seat_block():
    cands, posts = _cands(1), _posts([1])
    alloc = Allocation("x", (), ("c0",))
    assert count_blocking_pairs(alloc, cands, posts, np.array([[0.5]])) == 1


def test_edge_cases_do_not_error():
    empty = Allocation("x", (), ())
    assert count_blocking_pairs(empty, [], [], np.zeros((0, 0))) == 0
    cands, posts = _cands(2), _posts([0])
    alloc = Allocation("x", (), ("c0", "c1"))
    assert count_blocking_pairs(alloc, cands, posts, np.ones((2, 1))) == 0
    assert compare_algorithms([], [], np.zeros((0, 0)))["hungarian"].total_score == 0


def test_compare_returns_all_algorithms_with_runtime():
    cands, posts, scores = next(iter(_cases()))
    res = compare_algorithms(cands, posts, scores)
    assert set(res) == {"hungarian", "gale_shapley"} == set(ALGORITHMS)
    for r in res.values():
        assert isinstance(r, AlgorithmResult)
        assert r.runtime_ms >= 0
