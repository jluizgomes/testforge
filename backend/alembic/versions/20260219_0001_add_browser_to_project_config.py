"""Add browser column to project_configs.

Revision ID: 20260219_0001
Revises: 20260218_0005
Create Date: 2026-02-19

"""

from alembic import op
import sqlalchemy as sa

revision = "20260219_0001"
down_revision = "20260218_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_configs",
        sa.Column("browser", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_configs", "browser")
