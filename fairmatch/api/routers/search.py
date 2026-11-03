import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db import get_session
from api.deps import require_role
from api.models import Candidate, Opportunity, User
from api.schemas import IdPath, SimilarCandidateOut, SimilarLimitQuery

router = APIRouter(prefix="/opportunities", tags=["search"])


def _cosine(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    sim = sum(x * y for x, y in zip(a, b, strict=True)) / (na * nb)
    return sim if math.isfinite(sim) else 0.0


def similar_candidates(session: Session, opp: Opportunity, limit: int) -> list[dict]:
    """Top candidates by cosine similarity to the opportunity embedding."""
    if opp.embedding is None:
        return []
    if session.bind.dialect.name == "postgresql":
        dist = Candidate.embedding.cosine_distance(opp.embedding)
        q = (
            select(Candidate.id, dist)
            .where(Candidate.embedding.is_not(None))
            .order_by(dist, Candidate.id)
            .limit(limit)
        )
        rows = []
        for cid, d in session.execute(q):
            sim = 1.0 - float(d) if d is not None and math.isfinite(float(d)) else 0.0
            rows.append((cid, sim))
    else:
        q = select(Candidate.id, Candidate.embedding).where(Candidate.embedding.is_not(None))
        rows = [(cid, _cosine(emb, opp.embedding)) for cid, emb in session.execute(q) if emb]
    out = [{"candidate_id": cid, "similarity": round(sim, 6)} for cid, sim in rows]
    out.sort(key=lambda r: (-r["similarity"], r["candidate_id"]))
    return out[:limit]


@router.get("/{opportunity_id}/similar-candidates", response_model=list[SimilarCandidateOut])
def get_similar_candidates(
    opportunity_id: IdPath,
    _admin: Annotated[User, Depends(require_role("admin"))],
    session: Annotated[Session, Depends(get_session)],
    limit: SimilarLimitQuery = 10,
):
    opp = session.get(Opportunity, opportunity_id)
    if opp is None:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return similar_candidates(session, opp, limit)
