import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db import get_session
from api.deps import require_role
from api.models import Allocation, AllocationRun, User
from api.schemas import (
    ExplanationOut,
    IdPath,
    LimitQuery,
    OffsetQuery,
    RunCreatedOut,
    RunIn,
    RunOut,
    RunSummaryOut,
)
from api.services.runs import create_run, mark_failed, validate_run_preconditions
from api.worker import run_allocation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["runs"])

Admin = Annotated[User, Depends(require_role("admin"))]
Sess = Annotated[Session, Depends(get_session)]


@router.post("", response_model=RunCreatedOut, status_code=202)
def start_run(body: RunIn, admin: Admin, session: Sess):
    try:
        validate_run_preconditions(session)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    run = create_run(session, admin, body.algorithm)
    session.commit()  # the worker must see the row before it is enqueued
    try:
        run_allocation.delay(run.id)
    except Exception:
        logger.exception("could not enqueue run %s", run.id)
        session.rollback()
        mark_failed(session, run.id, "could not enqueue run: task queue unavailable")
        return JSONResponse(
            status_code=503, content={"detail": "Task queue unavailable; run marked failed"}
        )
    session.refresh(run)
    return {"id": run.id, "status": run.status}


@router.get("", response_model=list[RunSummaryOut])
def list_runs(_admin: Admin, session: Sess, limit: LimitQuery = 50, offset: OffsetQuery = 0):
    q = select(AllocationRun).order_by(AllocationRun.id.desc()).limit(limit).offset(offset)
    runs = list(session.scalars(q))
    emails = _emails(session, runs)
    return [_summary(r, emails) for r in runs]


def _emails(session: Session, runs: list[AllocationRun]) -> dict[int, str]:
    ids = {r.requested_by for r in runs}
    if not ids:
        return {}
    rows = session.execute(select(User.id, User.email).where(User.id.in_(ids)))
    return {uid: email for uid, email in rows}


def _summary(run: AllocationRun, emails: dict[int, str]) -> RunSummaryOut:
    out = RunSummaryOut.model_validate(run)
    out.requested_by_email = emails.get(run.requested_by)
    return out


def _get_run(session: Session, run_id: int) -> AllocationRun:
    run = session.get(AllocationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _allocations(session: Session, run: AllocationRun) -> list[Allocation]:
    if run.status != "done":
        return []
    q = select(Allocation).where(Allocation.run_id == run.id).order_by(Allocation.id)
    return list(session.scalars(q))


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: IdPath, _admin: Admin, session: Sess):
    run = _get_run(session, run_id)
    data = _summary(run, _emails(session, [run])).model_dump()
    data["allocations"] = _allocations(session, run)
    return RunOut.model_validate(data)


@router.get("/{run_id}/explanations", response_model=list[ExplanationOut])
def get_explanations(run_id: IdPath, _admin: Admin, session: Sess):
    return _allocations(session, _get_run(session, run_id))
