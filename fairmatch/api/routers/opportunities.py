import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db import get_session
from api.deps import get_current_user, require_role
from api.models import Opportunity, User
from api.schemas import IdPath, LimitQuery, OffsetQuery, OpportunityIn, OpportunityOut
from api.services.profiles import create_opportunity
from api.worker import embed_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/opportunities", tags=["opportunities"])


@router.post("", response_model=OpportunityOut, status_code=201)
def post_opportunity(
    body: OpportunityIn,
    _admin: Annotated[User, Depends(require_role("admin"))],
    session: Annotated[Session, Depends(get_session)],
) -> Opportunity:
    row = create_opportunity(session, body)
    session.commit()
    try:
        embed_profile.delay("opportunity", row.id)
    except Exception:
        logger.exception("could not enqueue embedding for opportunity %s", row.id)
    session.refresh(row)
    return row


@router.get("", response_model=list[OpportunityOut])
def list_opportunities(
    _user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
):
    q = select(Opportunity).order_by(Opportunity.id).limit(limit).offset(offset)
    return list(session.scalars(q))


@router.get("/{opportunity_id}", response_model=OpportunityOut)
def get_opportunity(
    opportunity_id: IdPath,
    _user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> Opportunity:
    row = session.get(Opportunity, opportunity_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return row
