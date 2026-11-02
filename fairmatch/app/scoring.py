"""
Scoring Module
--------------
Computes a "fit score" between one candidate and one opportunity by
combining two signals:

  1. Text similarity (from embeddings.py)  -- captures overall meaning
  2. Skill overlap ratio                   -- captures exact matching skills

The two are combined with weights that can be tuned. Every score comes
with a breakdown so the result can be explained (see explain.py).
"""

SIMILARITY_WEIGHT = 0.5
SKILL_OVERLAP_WEIGHT = 0.5


def skill_overlap_ratio(candidate_skills: list[str], required_skills: list[str]) -> float:
    """Fraction of the posting's required skills that the candidate has."""
    if not required_skills:
        return 0.0
    matched = set(candidate_skills) & set(required_skills)
    return len(matched) / len(required_skills)


def compute_fit_score(candidate: dict, posting: dict, embedding_service) -> dict:
    """Compute a combined fit score for one candidate-posting pair."""
    text_similarity = embedding_service.similarity(candidate["raw_text"], posting["raw_text"])
    overlap = skill_overlap_ratio(candidate["skills"], posting["required_skills"])
    matched_skills = sorted(set(candidate["skills"]) & set(posting["required_skills"]))

    final_score = (SIMILARITY_WEIGHT * text_similarity) + (SKILL_OVERLAP_WEIGHT * overlap)

    return {
        "candidate": candidate["name"],
        "posting": posting["title"],
        "text_similarity": round(text_similarity, 3),
        "skill_overlap": round(overlap, 3),
        "matched_skills": matched_skills,
        "final_score": round(final_score, 3),
    }
