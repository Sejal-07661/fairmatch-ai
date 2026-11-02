"""
Parser Module
-------------
Reads raw resume text or job/internship posting text and pulls out the
skills mentioned in it. Uses spaCy's PhraseMatcher against a known skill
list -- this is fast, needs no internet/model download, and is fully
explainable (we always know exactly which phrase matched).
"""

import spacy
from spacy.matcher import PhraseMatcher
from app.skills_data import SKILL_LIST

# blank English pipeline -- no pretrained model download needed,
# we only need the tokenizer for phrase matching.
_nlp = spacy.blank("en")
_matcher = PhraseMatcher(_nlp.vocab, attr="LOWER")
_patterns = [_nlp.make_doc(skill) for skill in SKILL_LIST]
_matcher.add("SKILL", _patterns)


def extract_skills(text: str) -> list[str]:
    """Return a sorted list of unique skills found in the given text."""
    doc = _nlp(text)
    matches = _matcher(doc)
    found = set()
    for match_id, start, end in matches:
        span = doc[start:end]
        found.add(span.text.lower())
    return sorted(found)


def extract_years_of_experience(text: str) -> int:
    """Very simple heuristic: looks for patterns like '3 years' or '2+ years'."""
    import re
    matches = re.findall(r"(\d+)\+?\s*years?", text.lower())
    if matches:
        return max(int(m) for m in matches)
    return 0


def parse_candidate(name: str, resume_text: str) -> dict:
    """Parse a candidate's resume into a structured profile."""
    return {
        "name": name,
        "raw_text": resume_text,
        "skills": extract_skills(resume_text),
        "experience_years": extract_years_of_experience(resume_text),
    }


def parse_posting(title: str, posting_text: str, capacity: int = 1) -> dict:
    """Parse an opportunity posting into a structured listing."""
    return {
        "title": title,
        "raw_text": posting_text,
        "required_skills": extract_skills(posting_text),
        "capacity": capacity,
    }
