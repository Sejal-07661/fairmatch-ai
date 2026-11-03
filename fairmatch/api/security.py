from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from api.config import get_settings

# Pinned: never trust the alg header of an incoming token.
_ALGORITHM = "HS256"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:  # malformed hash or password over 72 bytes
        return False


def create_access_token(user_id: int, role: str) -> str:
    s = get_settings()
    exp = datetime.now(UTC) + timedelta(minutes=s.access_token_minutes)
    claims = {"sub": str(user_id), "role": role, "exp": exp}
    return jwt.encode(claims, s.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        claims = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[_ALGORITHM],
            options={"require_exp": True, "verify_exp": True},
        )
    except JWTError as exc:
        raise ValueError("invalid token") from exc
    sub, role = claims.get("sub"), claims.get("role")
    if not (isinstance(sub, str) and sub.isascii() and sub.isdigit() and int(sub) > 0):
        raise ValueError("invalid token")
    exp = claims.get("exp")
    if not isinstance(role, str) or isinstance(exp, bool) or not isinstance(exp, int | float):
        raise ValueError("invalid token")  # noqa: TRY004
    return claims
