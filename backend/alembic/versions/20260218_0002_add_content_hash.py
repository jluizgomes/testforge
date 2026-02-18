"""Add content_hash to generated_tests for incremental scanning.

Revision ID: 20260218_0002
Revises: 20260218_0001
Create Date: 2026-02-18

"""

from alembic import op
import sqlalchemy as sa

revision = "20260218_0002"
down_revision = "20260218_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("generated_tests", sa.Column("content_hash", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("generated_tests", "content_hash")
