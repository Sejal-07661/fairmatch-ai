"""Prepare a fresh SQLite database for the Playwright end-to-end run.

Usage: python scripts/e2e_prepare.py <db_path>

Creates all tables and the admin admin@example.com / E2e-Passw0rd!. Prints nothing on success.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "E2e-Passw0rd!"


def prepare(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{Path(db_path).resolve().as_posix()}"
    os.environ.setdefault("JWT_SECRET", "e2e-secret")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    from sqlalchemy import select

    from api import models  # noqa: F401  (register tables on Base.metadata)
    from api.cli import create_admin
    from api.config import get_settings
    from api.db import Base, SessionLocal, get_engine, reset_engine_cache
    from api.models import User

    get_settings.cache_clear()
    reset_engine_cache()
    Base.metadata.create_all(get_engine())
    with SessionLocal() as session:
        if session.scalars(select(User).limit(1)).first() is not None:
            reset_engine_cache()
            raise SystemExit(f"error: {db_path} already contains users; refusing to reset the admin")
        create_admin(session, ADMIN_EMAIL, ADMIN_PASSWORD)
    reset_engine_cache()


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python scripts/e2e_prepare.py <db_path>", file=sys.stderr)
        return 2
    prepare(argv[0])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
