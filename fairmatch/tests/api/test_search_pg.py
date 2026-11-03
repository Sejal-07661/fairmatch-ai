import math
import os
from pathlib import Path

import numpy as np
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine

from api.config import get_settings
from api.routers.search import _cosine, similar_candidates

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.db
def test_pgvector_similarity_matches_python_cosine(monkeypatch):
    from sqlalchemy.orm import sessionmaker

    from api.models import Candidate, Opportunity, User

    url = os.environ["TEST_DATABASE_URL"]
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    engine = create_engine(url)
    try:
        command.upgrade(cfg, "head")
        rng = np.random.default_rng(7)
        vecs = [rng.normal(size=384).tolist() for _ in range(6)]
        query = rng.normal(size=384).tolist()
        with sessionmaker(bind=engine)() as s:
            opp = Opportunity(
                title="J", posting_text="t", required_skills=[], capacity=1,
                min_experience_years=0, min_education_level=0, embedding=query,
            )
            s.add(opp)
            for i, v in enumerate(vecs):
                u = User(email=f"pg{i}@x.com", password_hash="x", role="candidate")
                s.add(u)
                s.flush()
                s.add(Candidate(user_id=u.id, name=f"c{i}", resume_text="r", skills=[],
                                experience_years=0, education_level=0, embedding=v))
            u = User(email="pgnone@x.com", password_hash="x", role="candidate")
            s.add(u)
            s.flush()
            s.add(Candidate(user_id=u.id, name="none", resume_text="r", skills=[],
                            experience_years=0, education_level=0, embedding=None))
            s.commit()
            assert s.bind.dialect.name == "postgresql"
            got = similar_candidates(s, opp, 50)
            ids = [c.id for c in s.query(Candidate).filter(Candidate.embedding.is_not(None))]
            expected = sorted(
                ((cid, _cosine(c.embedding, query)) for cid in ids
                 for c in [s.get(Candidate, cid)]),
                key=lambda t: (-t[1], t[0]),
            )
        assert len(got) == len(vecs) == len(expected)
        assert [g["candidate_id"] for g in got] == [e[0] for e in expected]
        for g, e in zip(got, expected, strict=True):
            assert math.isclose(g["similarity"], e[1], abs_tol=1e-5)
    finally:
        try:
            command.downgrade(cfg, "base")
        finally:
            engine.dispose()
            get_settings.cache_clear()
