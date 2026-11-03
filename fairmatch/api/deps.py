from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from api.db import get_session
from api.models import User
from api.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    """Resolve the token to a User row.

    The database is the authority: the token's `role` claim is ignored, so a
    role change takes effect immediately and a forged/stale role claim is
    harmless. A token whose user no longer exists is rejected with 401.
    """
    unauthorized = HTTPException(
        status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"}
    )
    try:
        user_id = int(decode_access_token(token)["sub"])
    except (ValueError, KeyError):
        raise unauthorized from None
    user = session.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


def require_role(*roles: str) -> Callable:
    def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user

    return dependency
