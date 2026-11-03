import random

import pytest

from core.fairness import audit
from core.models import Allocation, Assignment


def _alloc(selected: list[str], unallocated: list[str] = ()) -> Allocation:
    return Allocation(
        "test",
        tuple(Assignment(c, "p1", 0.5) for c in selected),
        tuple(unallocated),
    )


def test_equal_rates_give_ratio_one():
    g = {"a1": "A", "a2": "A", "b1": "B", "b2": "B"}
    r = audit(_alloc(["a1", "b1"], ["a2", "b2"]), g)
    assert r.disparate_impact_ratio == 1.0
    assert r.passes_four_fifths is True
    assert r.parity_difference == 0.0


def test_disparate_impact_below_four_fifths_fails():
    g = {f"a{i}": "A" for i in range(4)} | {f"b{i}": "B" for i in range(4)}
    r = audit(_alloc(["a0", "a1", "b0"]), g)
    rates = {s.group: s.selection_rate for s in r.groups}
    assert rates == {"A": 0.5, "B": 0.25}
    assert r.disparate_impact_ratio == pytest.approx(0.5)
    assert r.passes_four_fifths is False
    assert r.parity_difference == pytest.approx(0.25)


def test_single_group_is_ratio_one():
    r = audit(_alloc(["a1"]), {"a1": "A", "a2": "A"})
    assert r.disparate_impact_ratio == 1.0
    assert r.passes_four_fifths is True


def test_nobody_selected_is_ratio_one():
    r = audit(_alloc([]), {"a1": "A", "b1": "B"})
    assert r.disparate_impact_ratio == 1.0
    assert r.parity_difference == 0.0
    assert all(s.mean_score == 0.0 for s in r.groups)


def test_empty_inputs():
    r = audit(_alloc([]), {})
    assert r.groups == ()
    assert r.disparate_impact_ratio == 1.0


def test_missing_group_label_raises_keyerror():
    with pytest.raises(KeyError, match="zz"):
        audit(_alloc(["zz"]), {"a1": "A"})


def test_matches_fairlearn():
    from fairlearn.metrics import demographic_parity_ratio

    rng = random.Random(7)
    ids = [f"c{i}" for i in range(40)]
    g = {i: rng.choice(["A", "B", "C"]) for i in ids}
    sel = [i for i in ids if rng.random() < 0.4]
    r = audit(_alloc(sel), g)
    expected = demographic_parity_ratio(
        [1] * len(ids),
        [1 if i in sel else 0 for i in ids],
        sensitive_features=[g[i] for i in ids],
    )
    assert r.disparate_impact_ratio == pytest.approx(expected)


def test_exact_four_fifths_boundary_passes():
    g = {f"a{i}": "A" for i in range(12)} | {f"b{i}": "B" for i in range(12)}
    sel = [f"a{i}" for i in range(4)] + [f"b{i}" for i in range(5)]
    r = audit(_alloc(sel), g)
    assert r.passes_four_fifths is True


def test_mean_score_over_selected_only():
    g = {"a1": "A", "a2": "A", "a3": "A", "a4": "A"}
    alloc = Allocation(
        "t",
        (Assignment("a1", "p1", 0.6), Assignment("a2", "p1", 0.8)),
        ("a3", "a4"),
    )
    r = audit(alloc, g)
    assert r.groups[0].mean_score == pytest.approx(0.7)


def test_unallocated_missing_group_label_raises_keyerror():
    with pytest.raises(KeyError, match="u9"):
        audit(_alloc([], ["u9"]), {"a1": "A"})
