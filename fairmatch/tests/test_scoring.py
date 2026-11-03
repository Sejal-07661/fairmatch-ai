import math

import pytest

from core.models import Candidate, Posting
from core.scoring import ScoreWeights, score_matrix, skill_overlap
from core.taxonomy import get_taxonomy


def _cand(i, skills=(), years=0, edu=0, text="python developer"):
    return Candidate(i, i, text, tuple(skills), years, edu)


def _post(i, req=(), min_years=0, min_edu=0, text="python role"):
    return Posting(i, i, text, tuple(req), 1, min_years, min_edu)


def test_weights_must_sum_to_one():
    assert ScoreWeights().semantic == 0.4
    with pytest.raises(ValueError):
        ScoreWeights(0.5, 0.5, 0.1, 0.1)
    with pytest.raises(ValueError):
        ScoreWeights(1.2, -0.2, 0.0, 0.0)


def test_exact_match_full_credit_related_half_credit():
    t = get_taxonomy()
    req = ("machine learning",)
    r, m, rel = skill_overlap(("machine learning",), req, t)
    assert (r, m, rel) == (1.0, ("machine learning",), ())
    r, m, rel = skill_overlap(("artificial intelligence",), req, t)
    assert r == 0.5 and m == () and rel == (("machine learning", "artificial intelligence"),)
    assert skill_overlap(("docker",), req, t)[0] == 0.0


def test_no_required_skills_gives_zero_overlap():
    assert skill_overlap(("python",), (), get_taxonomy()) == (0.0, (), ())


def test_experience_and_education_partial_credit(fake_embedder):
    _, bd = score_matrix(
        [_cand("c", years=1, edu=1)], [_post("p", min_years=2, min_edu=2)], fake_embedder
    )
    b = bd[0][0]
    assert b.experience == 0.5 and b.education == 0.5
    _, bd = score_matrix([_cand("c")], [_post("p")], fake_embedder)
    assert bd[0][0].experience == 1.0 and bd[0][0].education == 1.0


def test_score_matrix_shape_matches_breakdowns(fake_embedder):
    cs = [_cand("a", ["python"]), _cand("b", ["docker"]), _cand("c")]
    ps = [_post("x", ["python"]), _post("y", ["docker"], min_years=2)]
    m, bd = score_matrix(cs, ps, fake_embedder)
    assert m.shape == (3, 2)
    for i in range(3):
        for j in range(2):
            assert m[i, j] == bd[i][j].total
            assert not math.isnan(m[i, j])
    assert m[0, 0] > m[1, 0]


def test_empty_inputs_give_empty_matrix(fake_embedder):
    m, bd = score_matrix([], [_post("p")], fake_embedder)
    assert m.shape == (0, 1) and bd == []
    m, bd = score_matrix([_cand("c")], [], fake_embedder)
    assert m.shape == (1, 0) and bd == [[]]
    m, bd = score_matrix([], [], fake_embedder)
    assert m.shape == (0, 0)


def test_empty_text_no_nan(fake_embedder):
    m, _ = score_matrix([_cand("c", text="")], [_post("p", text="")], fake_embedder)
    assert m[0, 0] == m[0, 0]


def test_weights_reject_nan():
    with pytest.raises(ValueError):
        ScoreWeights(float("nan"), 0.4, 0.1, 0.1)


def test_weights_reject_inf():
    with pytest.raises(ValueError):
        ScoreWeights(float("inf"), 0.0, 0.0, 0.0)
    with pytest.raises(ValueError):
        ScoreWeights(float("-inf"), float("inf"), 0.5, 0.5)
