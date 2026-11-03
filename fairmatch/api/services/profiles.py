from sqlalchemy.orm import Session

from api.models import Candidate, Opportunity, User
from api.schemas import OpportunityIn
from core.llm import get_llm_client
from core.parser import parse_candidate, parse_posting


def create_candidate_profile(session: Session, user: User, name: str, text: str) -> Candidate:
    """Parse and add (not commit) a candidate row. Raises ValueError on blank text."""
    if not text.strip():
        raise ValueError("resume text must not be empty")
    parsed = parse_candidate(id=str(user.id), name=name, text=text, llm=get_llm_client())
    row = Candidate(
        user_id=user.id,
        name=name,
        resume_text=text,
        skills=list(parsed.skills),
        experience_years=float(parsed.experience_years),
        education_level=int(parsed.education_level),
        used_fallback=bool(parsed.used_fallback),
    )
    session.add(row)
    return row


def create_opportunity(session: Session, payload: OpportunityIn) -> Opportunity:
    parsed = parse_posting(
        id="new", title=payload.title, text=payload.posting_text,
        capacity=payload.capacity, llm=get_llm_client(),
    )
    row = Opportunity(
        title=payload.title,
        posting_text=payload.posting_text,
        required_skills=list(parsed.required_skills),
        capacity=payload.capacity,
        min_experience_years=payload.min_experience_years,
        min_education_level=payload.min_education_level,
    )
    session.add(row)
    return row
