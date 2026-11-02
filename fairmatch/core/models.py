from dataclasses import dataclass


@dataclass(frozen=True)
class Candidate:
    id: str
    name: str
    raw_text: str
    skills: tuple[str, ...]
    experience_years: int
    education_level: int
    used_fallback: bool = False


@dataclass(frozen=True)
class Posting:
    id: str
    title: str
    raw_text: str
    required_skills: tuple[str, ...]
    capacity: int
    min_experience_years: int = 0
    min_education_level: int = 0


@dataclass(frozen=True)
class ScoreBreakdown:
    candidate_id: str
    posting_id: str
    semantic: float
    skill_overlap: float
    experience: float
    education: float
    matched_skills: tuple[str, ...]
    related_skills: tuple[tuple[str, str], ...]
    total: float


@dataclass(frozen=True)
class Assignment:
    candidate_id: str
    posting_id: str
    score: float


@dataclass(frozen=True)
class Allocation:
    algorithm: str
    assignments: tuple[Assignment, ...]
    unallocated: tuple[str, ...]
