"""Add test_login_email and test_login_password to project_configs.

Revision ID: 20260218_0001
Revises: 20260217_0002
Create Date: 2026-02-18

"""

from alembic import op
import sqlalchemy as sa

revision = "20260218_0001"
down_revision = "20260217_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_configs", sa.Column("test_login_email", sa.String(255), nullable=True))
    op.add_column(
        "project_configs", sa.Column("test_login_password", sa.String(255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("project_configs", "test_login_password")
    op.drop_column("project_configs", "test_login_email")
