"""initial schema

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

from api.vector import EmbeddingType

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pg = op.get_bind().dialect.name == "postgresql"
    if pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "candidates",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("resume_text", sa.Text, nullable=False),
        sa.Column("skills", sa.JSON, nullable=False),
        sa.Column("experience_years", sa.Float, nullable=False),
        sa.Column("education_level", sa.Integer, nullable=False),
        sa.Column("used_fallback", sa.Boolean, nullable=False),
        sa.Column("embedding", EmbeddingType, nullable=True),
    )
    op.create_table(
        "candidate_demographics",
        sa.Column("candidate_id", sa.Integer, sa.ForeignKey("candidates.id"), primary_key=True),
        sa.Column("group_label", sa.String(100), nullable=False),
    )
    op.create_table(
        "opportunities",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("posting_text", sa.Text, nullable=False),
        sa.Column("required_skills", sa.JSON, nullable=False),
        sa.Column("capacity", sa.Integer, nullable=False),
        sa.Column("min_experience_years", sa.Float, nullable=False),
        sa.Column("min_education_level", sa.Integer, nullable=False),
        sa.Column("embedding", EmbeddingType, nullable=True),
    )
    op.create_table(
        "allocation_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("requested_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("algorithm", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("metrics", sa.JSON, nullable=True),
        sa.Column("fairness", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime, nullable=True),
    )
    op.create_table(
        "allocations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("run_id", sa.Integer, sa.ForeignKey("allocation_runs.id"), nullable=False),
        sa.Column("algorithm", sa.String(20), nullable=False),
        sa.Column("candidate_id", sa.Integer, sa.ForeignKey("candidates.id"), nullable=False),
        sa.Column("opportunity_id", sa.Integer, sa.ForeignKey("opportunities.id"), nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("breakdown", sa.JSON, nullable=False),
        sa.Column("reasons", sa.JSON, nullable=False),
        sa.Column("narrative", sa.Text, nullable=False),
        sa.Column("used_fallback", sa.Boolean, nullable=False),
        sa.UniqueConstraint(
            "run_id", "algorithm", "candidate_id", name="uq_allocation_run_algo_cand"
        ),
    )

    if pg:
        op.execute(
            "CREATE INDEX ix_candidates_embedding_hnsw ON candidates "
            "USING hnsw (embedding vector_cosine_ops)"
        )
        op.execute(
            "CREATE INDEX ix_opportunities_embedding_hnsw ON opportunities "
            "USING hnsw (embedding vector_cosine_ops)"
        )


def downgrade() -> None:
    pg = op.get_bind().dialect.name == "postgresql"
    if pg:
        op.execute("DROP INDEX IF EXISTS ix_opportunities_embedding_hnsw")
        op.execute("DROP INDEX IF EXISTS ix_candidates_embedding_hnsw")
    op.drop_table("allocations")
    op.drop_table("allocation_runs")
    op.drop_table("opportunities")
    op.drop_table("candidate_demographics")
    op.drop_table("candidates")
    op.drop_table("users")
    if pg:
        op.execute("DROP EXTENSION IF EXISTS vector")
