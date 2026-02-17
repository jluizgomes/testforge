"""Add scanner tables (scan_jobs, generated_tests).

Revision ID: add_scanner_tables
Revises: 9f1219c373ec
Create Date: 2026-02-17 00:01:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "add_scanner_tables"
down_revision: str | None = "9f1219c373ec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scan_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("files_found", sa.Integer, nullable=False, server_default="0"),
        sa.Column("entry_points_found", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tests_generated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("discovered_structure", sa.JSON, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_scan_jobs_project_id", "scan_jobs", ["project_id"])

    op.create_table(
        "generated_tests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("scan_job_id", sa.String(36), sa.ForeignKey("scan_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("test_name", sa.String(500), nullable=False),
        sa.Column("test_code", sa.Text, nullable=False),
        sa.Column("test_type", sa.String(50), nullable=False, server_default="e2e"),
        sa.Column("entry_point", sa.String(1000), nullable=True),
        sa.Column("accepted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_generated_tests_project_id", "generated_tests", ["project_id"])
    op.create_index("ix_generated_tests_scan_job_id", "generated_tests", ["scan_job_id"])


def downgrade() -> None:
    op.drop_table("generated_tests")
    op.drop_table("scan_jobs")
