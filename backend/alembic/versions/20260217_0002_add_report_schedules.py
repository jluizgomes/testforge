"""Add report_schedules table.

Revision ID: 20260217_0002
Revises: 20260217_0001
Create Date: 2026-02-17

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260217_0002"
down_revision = "add_scanner_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("cron_expr", sa.String(100), nullable=False),
        sa.Column("format", sa.String(20), nullable=False, server_default="html"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_report_schedules_project_id",
        "report_schedules",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_report_schedules_project_id", table_name="report_schedules")
    op.drop_table("report_schedules")
