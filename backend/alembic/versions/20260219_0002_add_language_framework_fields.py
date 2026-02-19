"""Add test_language, test_framework, error_category to test_results and generated_tests.

Revision ID: 20260219_0002
Revises: 20260219_0001
Create Date: 2026-02-19

"""

from alembic import op
import sqlalchemy as sa

revision = "20260219_0002"
down_revision = "20260219_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("test_results", sa.Column("test_language", sa.String(20), nullable=True))
    op.add_column("test_results", sa.Column("test_framework", sa.String(50), nullable=True))
    op.add_column("test_results", sa.Column("error_category", sa.String(50), nullable=True))
    op.add_column("generated_tests", sa.Column("test_language", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("generated_tests", "test_language")
    op.drop_column("test_results", "error_category")
    op.drop_column("test_results", "test_framework")
    op.drop_column("test_results", "test_language")
