import pytest

from core.allocation import ALGORITHMS
from core.llm import FakeLLMClient
from core.pipeline import run_pipeline
from sample_data.candidates import CANDIDATES
from sample_data.postings import POSTINGS


def _run(**kw):
    return run_pipeline(CANDIDATES, POSTINGS, **kw)


def test_pipeline_runs_end_to_end(fake_embedder):
    res = _run(embedder=fake_embedder, llm=None)
    assert set(res.results) == set(ALGORITHMS)
    caps = {p.id: p.capacity for p in res.postings}
    assert [c.id for c in res.candidates][:2] == ["c1", "c2"]
    for name, r in res.results.items():
        counts = {}
        for a in r.allocation.assignments:
            counts[a.posting_id] = counts.get(a.posting_id, 0) + 1
        assert all(n <= caps[p] for p, n in counts.items())
        exps = res.explanations[name]
        assert len(exps) == len(r.allocation.assignments)
        assert {e.candidate_id for e in exps} == {a.candidate_id for a in r.allocation.assignments}


def test_pipeline_without_groups_has_no_fairness(fake_embedder):
    assert _run(embedder=fake_embedder, llm=None).fairness is None


def test_pipeline_with_groups_audits_each_algorithm(fake_embedder):
    g = {f"c{i + 1}": ("a" if i % 2 else "b") for i in range(len(CANDIDATES))}
    res = _run(embedder=fake_embedder, llm=None, group_of=g)
    assert set(res.fairness) == set(ALGORITHMS)


def test_pipeline_missing_group_label_raises(fake_embedder):
    with pytest.raises(KeyError):
        _run(embedder=fake_embedder, llm=None, group_of={"c1": "a"})


@pytest.mark.parametrize("cands,posts", [([], []), ([], POSTINGS), (CANDIDATES, [])])
def test_pipeline_with_empty_inputs(fake_embedder, cands, posts):
    g = {f"c{i + 1}": "a" for i in range(len(cands))}
    res = run_pipeline(cands, posts, embedder=fake_embedder, llm=None, group_of=g)
    assert set(res.results) == set(ALGORITHMS)
    assert all(not r.allocation.assignments for r in res.results.values())
    assert all(v == () for v in res.explanations.values())


def test_pipeline_all_zero_capacity(fake_embedder):
    posts = [{**p, "capacity": 0} for p in POSTINGS]
    res = run_pipeline(CANDIDATES, posts, embedder=fake_embedder, llm=None)
    assert all(not r.allocation.assignments for r in res.results.values())


def test_pipeline_survives_llm_failure(fake_embedder):
    res = _run(embedder=fake_embedder, llm=FakeLLMClient(raises=True))
    assert all(c.used_fallback for c in res.candidates)
    assert all(e.used_fallback for es in res.explanations.values() for e in es)


def test_env_key_is_removed_for_non_llm_tests():
    import os

    from core.llm import get_llm_client

    assert os.environ.get("OPENAI_API_KEY") is None
    assert get_llm_client() is None


def test_pipeline_rejects_stale_group_ids(fake_embedder):
    g = {f"c{i + 1}": "a" for i in range(len(CANDIDATES))}
    g["zz"] = "b"
    with pytest.raises(ValueError, match="zz"):
        _run(embedder=fake_embedder, llm=None, group_of=g)
    with pytest.raises(ValueError):
        run_pipeline([], [], embedder=fake_embedder, llm=None, group_of={"c1": "a"})


def test_pipeline_explains_each_pair_once(fake_embedder):
    class Counting(FakeLLMClient):
        calls = 0

        def complete(self, prompt):
            Counting.calls += 1
            return "ok"

    res = _run(embedder=fake_embedder, llm=Counting(raises=True))
    pairs = {(e.candidate_id, e.posting_id) for es in res.explanations.values() for e in es}
    assert Counting.calls == len(pairs)
