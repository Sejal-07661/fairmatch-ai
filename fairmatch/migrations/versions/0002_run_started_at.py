"""add allocation_runs.started_at

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("allocation_runs") as batch:
        batch.add_column(sa.Column("started_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("allocation_runs") as batch:
        batch.drop_column("started_at")
