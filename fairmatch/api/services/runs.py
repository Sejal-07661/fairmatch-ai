import dataclasses
import logging
import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session

from api.config import get_settings
from api.models import (
    Allocation,
    AllocationRun,
    Candidate,
    CandidateDemographics,
    Opportunity,
    User,
)
from api.services import embedding
from core.llm import get_llm_client
from core.pipeline import run_pipeline

logger = logging.getLogger(__name__)

ALGORITHMS = ("hungarian", "gale_shapley")
VALID_ALGORITHMS = (*ALGORITHMS, "both")
MAX_CELLS = 25_000_000  # candidates * total seats (the Hungarian solver expands seats)


def validate_run_preconditions(session: Session) -> None:
    n_cand = session.scalar(select(func.count()).select_from(Candidate)) or 0
    n_opp = session.scalar(select(func.count()).select_from(Opportunity)) or 0
    seats = session.scalar(select(func.coalesce(func.sum(Opportunity.capacity), 0))) or 0
    if n_cand == 0:
        raise ValueError("Cannot start a run: there are no candidates")
    if n_opp == 0:
        raise ValueError("Cannot start a run: there are no opportunities")
    if seats <= 0:
        raise ValueError("Cannot start a run: total seats across opportunities is 0")
    if n_cand * seats > MAX_CELLS:
        raise ValueError(
            f"Run too large: candidates ({n_cand}) x total seats ({seats}) = {n_cand * seats} "
            f"exceeds the limit of {MAX_CELLS}"
        )


def create_run(session: Session, user: User, algorithm: str) -> AllocationRun:
    if algorithm not in VALID_ALGORITHMS:
        raise ValueError(f"algorithm must be one of {', '.join(VALID_ALGORITHMS)}")
    run = AllocationRun(requested_by=user.id, algorithm=algorithm, status="pending")
    session.add(run)
    session.flush()
    return run


def _naive_utc(dt: datetime | None = None) -> datetime:
    """Columns are timezone-naive and hold UTC; normalise any input to that."""
    dt = dt or datetime.now(UTC)
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def reclaim_stuck_runs(session: Session, now: datetime | None = None) -> list[int]:
    """Reset expired `running` runs to `pending` and return every run id to re-enqueue
    (those reset plus `pending` runs older than the grace period)."""
    s = get_settings()
    now_n = _naive_utc(now)
    stale_running = now_n - timedelta(minutes=s.run_timeout_minutes)
    stale_pending = now_n - timedelta(minutes=s.pending_grace_minutes)
    ids: list[int] = []
    candidates = [
        (r.id, r.status, r.created_at)
        for r in session.scalars(
            select(AllocationRun).where(AllocationRun.status.in_(("running", "pending")))
            .order_by(AllocationRun.id)
        )
    ]
    for run_id, status, created_at in candidates:
        if status == "running":
            # Guarded UPDATE: a run claimed concurrently (fresh started_at) is not touched.
            # started_at missing on a running row (legacy) counts as expired.
            res = session.execute(
                update(AllocationRun)
                .where(
                    AllocationRun.id == run_id,
                    AllocationRun.status == "running",
                    or_(AllocationRun.started_at.is_(None),
                        AllocationRun.started_at < stale_running),
                )
                .values(status="pending", started_at=None, error=None)
            )
            if res.rowcount == 1:
                ids.append(run_id)
        elif _naive_utc(created_at) < stale_pending:
            ids.append(run_id)
    session.commit()
    return ids


def mark_failed(session: Session, run_id: int, message: str) -> None:
    session.execute(
        update(AllocationRun)
        .where(AllocationRun.id == run_id)
        .values(status="failed", error=message[:500], finished_at=datetime.now(UTC))
    )
    session.commit()


def _finite(x: float, what: str) -> float:
    x = float(x)
    if not math.isfinite(x):
        raise ValueError(f"non-finite {what}")
    return x


def execute_run(session: Session, run_id: int) -> None:
    now_n = _naive_utc()
    expired = now_n - timedelta(minutes=get_settings().run_timeout_minutes)
    claim = session.execute(
        update(AllocationRun)
        .where(
            AllocationRun.id == run_id,
            or_(
                AllocationRun.status.in_(("pending", "failed")),
                and_(
                    AllocationRun.status == "running",
                    or_(AllocationRun.started_at.is_(None), AllocationRun.started_at < expired),
                ),
            ),
        )
        .values(status="running", error=None, finished_at=None, started_at=now_n)
    )
    session.commit()
    if claim.rowcount != 1:
        return  # unknown, done or running: idempotent re-delivery

    try:
        _do_run(session, run_id)
    except Exception as exc:  # noqa: BLE001  (any failure must end the run as failed)
        session.rollback()
        logger.warning("run %s failed: %s", run_id, type(exc).__name__)
        mark_failed(session, run_id, str(exc) or type(exc).__name__)


def _do_run(session: Session, run_id: int) -> None:
    run = session.get(AllocationRun, run_id)
    wanted = list(ALGORITHMS) if run.algorithm == "both" else [run.algorithm]

    cands = list(session.scalars(select(Candidate).order_by(Candidate.id)))
    opps = list(session.scalars(select(Opportunity).order_by(Opportunity.id)))
    labels = dict(session.execute(select(
        CandidateDemographics.candidate_id, CandidateDemographics.group_label)).all())

    metrics: dict = {}
    group_of = None
    missing = sum(1 for c in cands if c.id not in labels)
    if missing:
        metrics["fairness_skipped"] = (
            f"demographics missing for {missing} of {len(cands)} candidates"
        )
    else:
        group_of = {f"c{i}": labels[c.id] for i, c in enumerate(cands, 1)}

    result = run_pipeline(
        [{"name": c.name, "resume_text": c.resume_text} for c in cands],
        [{"title": o.title, "posting_text": o.posting_text, "capacity": o.capacity}
         for o in opps],
        group_of=group_of,
        embedder=embedding.get_embedder(),
        llm=get_llm_client(),
    )

    cid = {f"c{i}": c.id for i, c in enumerate(cands, 1)}
    pid = {f"p{j}": o.id for j, o in enumerate(opps, 1)}
    cidx = {f"c{i}": i - 1 for i in range(1, len(cands) + 1)}
    pidx = {f"p{j}": j - 1 for j in range(1, len(opps) + 1)}

    rows: list[Allocation] = []
    fairness: dict = {}
    for name in wanted:
        res = result.results[name]
        alloc = res.allocation
        metrics[name] = {
            "total_score": _finite(res.total_score, "total_score"),
            "blocking_pairs": int(res.blocking_pairs),
            "runtime_ms": _finite(res.runtime_ms, "runtime_ms"),
            "unallocated": [cid[u] for u in alloc.unallocated],
        }
        for a, ex in zip(alloc.assignments, result.explanations[name], strict=True):
            bd = dataclasses.asdict(result.breakdowns[cidx[a.candidate_id]][pidx[a.posting_id]])
            bd.pop("candidate_id")
            bd.pop("posting_id")
            rows.append(Allocation(
                run_id=run_id, algorithm=name, candidate_id=cid[a.candidate_id],
                opportunity_id=pid[a.posting_id], score=_finite(a.score, "score"),
                breakdown=bd, reasons=list(ex.reasons), narrative=ex.narrative,
                used_fallback=ex.used_fallback,
            ))
        if result.fairness is not None:
            fairness[name] = dataclasses.asdict(result.fairness[name])

    session.execute(delete(Allocation).where(Allocation.run_id == run_id))
    session.add_all(rows)
    session.execute(
        update(AllocationRun).where(AllocationRun.id == run_id).values(
            status="done", metrics=metrics, fairness=fairness or None,
            finished_at=datetime.now(UTC), error=None,
        )
    )
    session.commit()
