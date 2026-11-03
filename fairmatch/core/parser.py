"""Taxonomy-aware parsing of resumes and postings (LLM first, spaCy fallback)."""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path

import spacy
from spacy.matcher import PhraseMatcher

from core.llm import LLMClient
from core.models import Candidate, Posting
from core.taxonomy import Taxonomy, get_taxonomy

log = logging.getLogger(__name__)
_nlp = spacy.blank("en")


@lru_cache(maxsize=8)
def _matcher_for(taxonomy: Taxonomy) -> PhraseMatcher:
    m = PhraseMatcher(_nlp.vocab, attr="LOWER")
    m.add("SKILL", [_nlp.make_doc(t) for t in taxonomy.all_terms()])
    return m


def extract_skills_spacy(text: str, taxonomy: Taxonomy) -> tuple[str, ...]:
    if not text or not text.strip():
        return ()
    doc = _nlp(" ".join(text.split()))
    found = set()
    for _, start, end in _matcher_for(taxonomy)(doc):
        canon = taxonomy.canonical(doc[start:end].text)
        if canon:
            found.add(canon)
    return tuple(sorted(found))


def _regex_experience(text: str) -> int:
    nums = re.findall(r"(\d+)\+?\s*years?", text.lower())
    return max(int(n) for n in nums) if nums else 0


_PHD = re.compile(r"\bph\.?\s?d\b|\bdoctorate\b", re.IGNORECASE)
_MASTER = re.compile(r"(?<![\w'’])m\.?\s?tech\b|\bmasters?\b|\bmca\b|\bm\.\s?sc\b|\bmsc\b|\bmba\b", re.IGNORECASE)
_BACH = re.compile(r"\bb\.?\s?tech\b|\bbachelors?\b|\bb\.\s?e\b|\bb\.\s?sc\b|\bbsc\b|\bbca\b", re.IGNORECASE)
_BE_UPPER = re.compile(r"\bBE\b")  # case-sensitive: the degree, not the verb "be"


def _regex_education(text: str) -> int:
    if _PHD.search(text):
        return 4
    if _MASTER.search(text):
        return 3
    if _BACH.search(text) or _BE_UPPER.search(text):
        return 2
    return 0


def _clean_profile(prof: dict, tax: Taxonomy):
    skills = prof["skills"]
    if not isinstance(skills, (list, tuple)) or not all(isinstance(x, str) for x in skills):
        raise ValueError("invalid skills")
    years, edu = prof["experience_years"], prof["education_level"]
    if isinstance(years, bool) or not isinstance(years, int):
        raise TypeError("invalid experience_years")
    if isinstance(edu, bool) or not isinstance(edu, int):
        raise TypeError("invalid education_level")
    canon = {c for x in skills if (c := tax.canonical(x))}
    return tuple(sorted(canon)), max(0, years), min(4, max(0, edu))


def _extract(text: str, llm: LLMClient | None, tax: Taxonomy):
    """Return (skills, years, education, used_fallback)."""
    if llm is not None:
        try:
            prof = llm.extract_profile(text)
            skills, years, edu = _clean_profile(prof, tax)
            return skills, years, edu, False
        except Exception as exc:  # noqa: BLE001 - any LLM failure falls back
            log.warning("LLM extraction failed, using spaCy fallback: %s", exc)
    return (extract_skills_spacy(text, tax), _regex_experience(text),
            _regex_education(text), True)


def parse_candidate(id: str, name: str, text: str, llm: LLMClient | None = None,
                    taxonomy: Taxonomy | None = None) -> Candidate:
    skills, years, edu, fb = _extract(text, llm, taxonomy or get_taxonomy())
    return Candidate(id=id, name=name, raw_text=text, skills=skills,
                     experience_years=years, education_level=edu, used_fallback=fb)


def parse_posting(id: str, title: str, text: str, capacity: int,
                  llm: LLMClient | None = None,
                  taxonomy: Taxonomy | None = None) -> Posting:
    skills, years, edu, _ = _extract(text, llm, taxonomy or get_taxonomy())
    return Posting(id=id, title=title, raw_text=text, required_skills=skills,
                   capacity=capacity, min_experience_years=years,
                   min_education_level=edu)


def read_resume_file(path: Path) -> str:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        import fitz

        with fitz.open(path) as pdf:
            return "\n".join(page.get_text() for page in pdf)
    if suffix == ".docx":
        import docx

        return "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
    if suffix in (".txt", ".md"):
        return path.read_text(encoding="utf-8")
    raise ValueError(f"Unsupported file type: {suffix or '(none)'}")
