"""Widen credential columns for encrypted values.

Revision ID: 20260218_0003
Revises: 20260218_0002
Create Date: 2026-02-18

"""

from alembic import op
import sqlalchemy as sa

revision = "20260218_0003"
down_revision = "20260218_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Encrypted Fernet tokens are longer than plaintext — widen columns
    op.alter_column(
        "project_configs",
        "test_login_password",
        type_=sa.String(500),
        existing_type=sa.String(255),
    )
    op.alter_column(
        "project_configs",
        "database_url",
        type_=sa.String(1000),
        existing_type=sa.String(500),
    )


def downgrade() -> None:
    op.alter_column(
        "project_configs",
        "test_login_password",
        type_=sa.String(255),
        existing_type=sa.String(500),
    )
    op.alter_column(
        "project_configs",
        "database_url",
        type_=sa.String(500),
        existing_type=sa.String(1000),
    )
