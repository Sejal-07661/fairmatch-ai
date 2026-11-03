import re

from core.explain import explain
from core.models import Candidate, Posting, ScoreBreakdown
from core.scoring import ScoreWeights

W = ScoreWeights()


class RecordingLLM:
    def __init__(self, completion="LLM story", exc=None):
        self.prompts = []
        self._completion = completion
        self._exc = exc

    def extract_profile(self, text):
        raise AssertionError("not used")

    def complete(self, prompt):
        self.prompts.append(prompt)
        if self._exc:
            raise self._exc
        return self._completion


def _cand():
    return Candidate("c1", "Alice", "SECRET RESUME TEXT xyz", ("python",), 3, 2)


def _post():
    return Posting("p1", "Backend Dev", "SECRET POSTING TEXT abc", ("python",), 1)


def _bd(sem=0.8, sk=0.5, ex=1.0, ed=0.5, matched=("python", "fastapi"), related=()):
    total = sem * W.semantic + sk * W.skill + ex * W.experience + ed * W.education
    return ScoreBreakdown("c1", "p1", sem, sk, ex, ed, matched, related, total)


def test_reasons_report_weighted_contributions():
    bd = _bd()
    e = explain(bd, _cand(), _post(), W)
    pat = re.compile(r"= (\d+\.\d+)")
    contribs = [float(pat.search(r).group(1)) for r in e.reasons[:4]]
    assert len(contribs) == 4
    assert abs(sum(contribs) - bd.total) < 1e-3
    assert any("python, fastapi" in r for r in e.reasons)


def test_related_skill_pair_appears_in_reasons():
    e = explain(_bd(related=(("pytorch", "tensorflow"),)), _cand(), _post(), W)
    assert any("pytorch" in r and "tensorflow" in r for r in e.reasons)


def test_llm_narrative_used_and_prompt_excludes_resume_text():
    llm = RecordingLLM()
    e = explain(_bd(), _cand(), _post(), W, llm)
    assert e.narrative == "LLM story" and not e.used_fallback
    p = llm.prompts[0]
    assert _cand().raw_text not in p and _post().raw_text not in p
    assert "Alice" in p and "Backend Dev" in p and e.reasons[0] in p


def test_fallback_when_llm_raises():
    e = explain(_bd(), _cand(), _post(), W, RecordingLLM(exc=RuntimeError("refusal")))
    assert e.used_fallback
    assert e.reasons[0] in e.narrative


def test_fallback_when_no_llm():
    e = explain(_bd(), _cand(), _post(), W)
    assert e.used_fallback and e.narrative


def test_zero_score_and_empty_skills():
    e = explain(_bd(0, 0, 0, 0, matched=()), _cand(), _post(), W)
    assert len(e.reasons) >= 4
    assert any("none" in r for r in e.reasons)
