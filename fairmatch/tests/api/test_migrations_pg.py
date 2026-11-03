import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from api.config import get_settings

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.db
def test_migration_upgrade_head_creates_hnsw_indexes(monkeypatch):
    url = os.environ["TEST_DATABASE_URL"]
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    engine = create_engine(url)
    try:
        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            ext = conn.execute(text("SELECT 1 FROM pg_extension WHERE extname='vector'")).first()
            assert ext is not None
            defs = [r[0] for r in conn.execute(text(
                "SELECT indexdef FROM pg_indexes WHERE schemaname='public'"))]
            hnsw = [d for d in defs if "hnsw" in d and "vector_cosine_ops" in d]
            assert any("candidates" in d for d in hnsw)
            assert any("opportunities" in d for d in hnsw)
        command.downgrade(cfg, "base")
        with engine.connect() as conn:
            tables = [r[0] for r in conn.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                "AND tablename <> 'alembic_version'"))]
            assert tables == []
    finally:
        engine.dispose()
        get_settings.cache_clear()
