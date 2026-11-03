from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.db import get_session
from api.models import User
from api.schemas import RegisterIn, TokenOut, UserOut
from api.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Verified against when the email is unknown, so both failure paths cost a bcrypt check.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: RegisterIn, session: Annotated[Session, Depends(get_session)]) -> User:
    user = User(email=body.email, password_hash=hash_password(body.password), role="candidate")
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Email already registered") from None
    return user


@router.post("/login", response_model=TokenOut)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[Session, Depends(get_session)],
) -> TokenOut:
    email = form.username.strip().lower()
    if chr(0) in email or len(email) > 320:
        verify_password(form.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = session.scalars(select(User).where(User.email == email)).first()
    ok = verify_password(form.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenOut(access_token=create_access_token(user.id, user.role))
