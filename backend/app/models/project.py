"""Project model for test projects."""

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.test_run import TestRun


class ProjectConfig(Base, UUIDMixin, TimestampMixin):
    """Configuration settings for a project."""

    __tablename__ = "project_configs"

    project_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # URLs
    frontend_url: Mapped[str | None] = mapped_column(String(500))
    backend_url: Mapped[str | None] = mapped_column(String(500))
    openapi_url: Mapped[str | None] = mapped_column(String(500))
    database_url: Mapped[str | None] = mapped_column(String(500))
    redis_url: Mapped[str | None] = mapped_column(String(500))

    # Test settings
    playwright_config: Mapped[dict | None] = mapped_column(JSON)
    test_timeout: Mapped[int] = mapped_column(default=30000)
    parallel_workers: Mapped[int] = mapped_column(default=1)
    retry_count: Mapped[int] = mapped_column(default=0)

    # AI settings
    ai_provider: Mapped[str | None] = mapped_column(String(50))
    ai_model: Mapped[str | None] = mapped_column(String(100))

    def __repr__(self) -> str:
        return f"<ProjectConfig(id={self.id}, project_id={self.project_id})>"


class Project(Base, UUIDMixin, TimestampMixin):
    """A test project containing test configurations and runs."""

    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    path: Mapped[str] = mapped_column(String(1000), nullable=False)

    # Status
    is_active: Mapped[bool] = mapped_column(default=True)

    # Relationships
    test_runs: Mapped[list["TestRun"]] = relationship(
        "TestRun",
        back_populates="project",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name={self.name})>"
