import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.models import User
from api.security import hash_password


def create_admin(session: Session, email: str, password: str) -> User:
    """Create an admin, or promote an existing user and reset their password."""
    email = email.strip().lower()
    if not email:
        raise ValueError("email must not be blank")
    if len(password) < 8 or len(password.encode("utf-8")) > 72:
        raise ValueError("password must be 8 characters to 72 bytes")
    user = session.scalars(select(User).where(User.email == email)).first()
    if user is None:
        user = User(email=email, password_hash=hash_password(password), role="admin")
        session.add(user)
    else:
        user.role = "admin"
        user.password_hash = hash_password(password)
    session.commit()
    return user


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="api.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin")
    p.add_argument("email")
    p.add_argument("password")
    args = parser.parse_args(argv)

    from api.db import SessionLocal  # deferred: settings are only needed when running

    with SessionLocal() as session:
        try:
            user = create_admin(session, args.email, args.password)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(user.id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
