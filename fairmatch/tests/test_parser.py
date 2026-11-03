import pytest

from core.llm import FakeLLMClient
from core.parser import (
    extract_skills_spacy,
    parse_candidate,
    parse_posting,
    read_resume_file,
)
from core.taxonomy import get_taxonomy
from sample_data.candidates import CANDIDATES

TAX = get_taxonomy()


def test_spacy_fallback_extracts_canonical_skills():
    c = CANDIDATES[0]
    cand = parse_candidate("c1", c["name"], c["resume_text"], llm=None)
    for s in ("fastapi", "mongodb", "python", "docker"):
        assert s in cand.skills
    assert cand.used_fallback is True


def test_alias_is_canonicalised():
    assert "react.js" in extract_skills_spacy("I know React", TAX)


def test_llm_skills_filtered_through_taxonomy():
    llm = FakeLLMClient(profile={"skills": ["Python", "Basket Weaving"],
                                 "experience_years": 2, "education_level": 2})
    cand = parse_candidate("c1", "A", "whatever", llm=llm)
    assert cand.skills == ("python",)
    assert cand.used_fallback is False
    assert cand.experience_years == 2


def test_llm_failure_falls_back():
    cand = parse_candidate("c1", "A", "Python and Docker, 3 years", llm=FakeLLMClient(raises=True))
    assert "python" in cand.skills
    assert cand.used_fallback is True


def test_llm_non_runtime_exception_falls_back():
    class Boom:
        def extract_profile(self, text):
            raise ValueError("bad json")

        def complete(self, prompt):
            return ""

    assert parse_candidate("c1", "A", "Python", llm=Boom()).used_fallback is True


def test_empty_and_non_ascii_text():
    for t in ("", "Dévéloppeur 日本語"):
        assert parse_candidate("c", "n", t).skills == ()
        assert extract_skills_spacy(t, TAX) == ()


def test_experience_and_education_regex():
    assert parse_candidate("c", "n", "3 years of work").experience_years == 3
    assert parse_candidate("c", "n", "nothing").experience_years == 0
    assert parse_candidate("c", "n", "B.Tech student").education_level == 2
    assert parse_candidate("c", "n", "MCA graduate").education_level == 3
    assert parse_candidate("c", "n", "PhD in physics").education_level == 4
    assert parse_candidate("c", "n", "nothing").education_level == 0


def test_word_boundary_no_substring_match():
    assert extract_skills_spacy("revue of the reactor", TAX) == ()


def test_parse_posting():
    p = parse_posting("p1", "Dev", "Needs Python and Docker", 2)
    assert p.capacity == 2
    assert {"python", "docker"} <= set(p.required_skills)


def test_read_resume_file_text(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("hello Python", encoding="utf-8")
    assert read_resume_file(f) == "hello Python"


def test_read_resume_file_rejects_unknown_suffix(tmp_path):
    f = tmp_path / "a.xyz"
    f.write_text("x")
    with pytest.raises(ValueError):
        read_resume_file(f)
    with pytest.raises(ValueError):
        read_resume_file(tmp_path / "noext")


@pytest.mark.parametrize("text,level", [
    ("I want to be a developer", 0), ("system technician", 0), ("graphdb", 0),
    ("platform technologies", 0), ("team tech lead", 0),
    ("B.Tech", 2), ("B.E.", 2), ("Bachelor of Science", 2),
    ("M.Tech", 3), ("MCA", 3), ("Master's degree", 3),
    ("Ph.D", 4), ("PhD", 4),
    ("B Tech in CSE", 2), ("M Tech", 3), ("BE in IT", 2), ("BE degree", 2),
    ("I'm tech-savvy", 0),
])
def test_education_regex_boundaries(text, level):
    assert parse_candidate("c", "n", text).education_level == level


def test_multiword_skills_across_whitespace():
    assert "machine learning" in parse_candidate("c", "n", "machine\nlearning").skills
    assert "deep learning" in parse_candidate("c", "n", "deep   learning").skills


def test_sample_multiword_skills():
    from sample_data.candidates import CANDIDATES as C
    from sample_data.postings import POSTINGS as P
    by = {c["name"].split()[0]: c["resume_text"] for c in C}
    assert "machine learning" in parse_candidate("a", "a", by["Aarav"]).skills
    assert "deep learning" in parse_candidate("a", "a", by["Rohan"]).skills
    assert "data analysis" in parse_candidate("a", "a", by["Ishaan"]).skills
    ai = next(p for p in P if "AI" in p["title"])
    text = ai.get("description") or ai.get("posting_text") or ai.get("raw_text")
    assert "computer vision" in parse_posting("p", "t", text, 1).required_skills


@pytest.mark.parametrize("bad", [
    {"skills": "python", "experience_years": 1, "education_level": 1},
    {"skills": [1, 2], "experience_years": 1, "education_level": 1},
    {"skills": ["python"], "experience_years": "x", "education_level": 1},
    {"skills": ["python"], "experience_years": 1, "education_level": None},
])
def test_invalid_llm_profile_falls_back(bad):
    c = parse_candidate("c", "n", "Docker", llm=FakeLLMClient(profile=bad))
    assert c.used_fallback is True
    assert c.skills == ("docker",)


def test_llm_values_clamped():
    p = {"skills": ["python"], "experience_years": -3, "education_level": 99}
    c = parse_candidate("c", "n", "x", llm=FakeLLMClient(profile=p))
    assert (c.experience_years, c.education_level, c.used_fallback) == (0, 4, False)
    p["education_level"] = -1
    assert parse_candidate("c", "n", "x", llm=FakeLLMClient(profile=p)).education_level == 0
