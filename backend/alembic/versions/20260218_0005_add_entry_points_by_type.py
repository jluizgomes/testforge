"""Add entry_points_by_type JSON column to scan_jobs.

Revision ID: 20260218_0005
Revises: 20260218_0004
Create Date: 2026-02-18

"""

from alembic import op
import sqlalchemy as sa

revision = "20260218_0005"
down_revision = "20260218_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scan_jobs", sa.Column("entry_points_by_type", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("scan_jobs", "entry_points_by_type")
