import logging
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.db import get_session
from api.deps import require_role
from api.models import Candidate, CandidateDemographics, User
from api.schemas import (
    MAX_TEXT_CHARS,
    CandidateOut,
    DemographicsIn,
    DemographicsOut,
    IdPath,
    LimitQuery,
    OffsetQuery,
    reject_nul,
)
from api.services.profiles import create_candidate_profile
from api.worker import embed_profile
from core.parser import read_resume_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/candidates", tags=["candidates"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_SUFFIXES = {".pdf", ".docx", ".txt"}

CandidateUser = Annotated[User, Depends(require_role("candidate", "admin"))]
Admin = Annotated[User, Depends(require_role("admin"))]
Sess = Annotated[Session, Depends(get_session)]


def _unprocessable(msg: str) -> HTTPException:
    return HTTPException(status_code=422, detail=msg)


def _extract_text(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise _unprocessable("Unsupported file type; use .pdf, .docx or .txt")
    data = upload.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise _unprocessable("File too large (size limit is 5 MiB)")
    if not data:
        raise _unprocessable("File is empty")
    with tempfile.TemporaryDirectory(prefix="fairmatch-upload-") as tmp:
        path = Path(tmp) / f"resume{suffix}"
        path.write_bytes(data)
        error = None
        try:
            return reject_nul_text(read_resume_file(path))
        except UnicodeDecodeError:
            error = "Text file is not valid UTF-8"
        except ValueError as exc:
            error = str(exc) if "NUL" in str(exc) else f"Could not parse file as {suffix}"
        except Exception:  # noqa: BLE001 - any parser failure is a 422
            error = f"Could not parse file as {suffix}"
    # Raised after the directory is gone: the parser traceback must not pin the file open.
    raise _unprocessable(error)


def reject_nul_text(v: str) -> str:
    return reject_nul(v)


@router.post("", response_model=CandidateOut, status_code=201)
def create_candidate(
    user: CandidateUser,
    session: Sess,
    name: Annotated[str, Form()],
    resume_text: Annotated[str | None, Form()] = None,
    resume: Annotated[UploadFile | None, File()] = None,
) -> Candidate:
    if "\x00" in name or (resume_text and "\x00" in resume_text):
        raise _unprocessable("NUL characters are not allowed")
    name = name.strip()
    if not name or len(name) > 255:
        raise _unprocessable("name must be 1-255 characters")
    if (resume_text is None) == (resume is None):
        raise _unprocessable("Provide exactly one of resume_text or resume file")
    text = resume_text if resume_text is not None else _extract_text(resume)
    if not text.strip():
        raise _unprocessable("Resume text is empty")
    if len(text) > MAX_TEXT_CHARS:
        raise _unprocessable(f"Resume text exceeds {MAX_TEXT_CHARS} characters")
    if session.scalars(select(Candidate).where(Candidate.user_id == user.id)).first():
        raise HTTPException(status_code=409, detail="Profile already exists")
    row = create_candidate_profile(session, user, name, text)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Profile already exists") from None
    try:
        embed_profile.delay("candidate", row.id)
    except Exception:
        logger.exception("could not enqueue embedding for candidate %s", row.id)
    session.refresh(row)
    return row


@router.get("/me", response_model=CandidateOut)
def get_me(user: CandidateUser, session: Sess) -> Candidate:
    row = session.scalars(select(Candidate).where(Candidate.user_id == user.id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No candidate profile")
    return row


@router.get("", response_model=list[CandidateOut])
def list_candidates(
    _admin: Admin,
    session: Sess,
    limit: LimitQuery = 50,
    offset: OffsetQuery = 0,
):
    q = select(Candidate).order_by(Candidate.id).limit(limit).offset(offset)
    return list(session.scalars(q))


def _get_or_404(session: Session, candidate_id: IdPath) -> Candidate:
    row = session.get(Candidate, candidate_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return row


# Candidate-role users get 403 on every {id} route (admin-only), never data.
@router.get("/{candidate_id}", response_model=CandidateOut)
def get_candidate(candidate_id: IdPath, _admin: Admin, session: Sess) -> Candidate:
    return _get_or_404(session, candidate_id)


@router.put("/{candidate_id}/demographics", response_model=DemographicsOut)
def put_demographics(
    candidate_id: IdPath, body: DemographicsIn, _admin: Admin, session: Sess
) -> CandidateDemographics:
    _get_or_404(session, candidate_id)
    row = session.get(CandidateDemographics, candidate_id)
    if row is None:
        row = CandidateDemographics(candidate_id=candidate_id, group_label=body.group_label)
        session.add(row)
    else:
        row.group_label = body.group_label
    session.commit()
    return row


@router.get("/{candidate_id}/demographics", response_model=DemographicsOut)
def get_demographics(candidate_id: IdPath, _admin: Admin, session: Sess) -> CandidateDemographics:
    _get_or_404(session, candidate_id)
    row = session.get(CandidateDemographics, candidate_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No demographics recorded")
    return row
