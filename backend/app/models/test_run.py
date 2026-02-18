"""Test run models."""

from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.trace import Trace


class TestRunStatus(str, Enum):
    """Status of a test run."""

    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ERROR = "error"


class TestResultStatus(str, Enum):
    """Status of a single test result."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


class TestRun(Base, UUIDMixin, TimestampMixin):
    """A test execution run."""

    __tablename__ = "test_runs"

    project_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[TestRunStatus] = mapped_column(
        String(20),
        default=TestRunStatus.PENDING,
    )

    # Timing
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Results summary
    total_tests: Mapped[int] = mapped_column(Integer, default=0)
    passed_tests: Mapped[int] = mapped_column(Integer, default=0)
    failed_tests: Mapped[int] = mapped_column(Integer, default=0)
    skipped_tests: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    # Configuration used
    config: Mapped[dict | None] = mapped_column(JSON)

    # Error info
    error_message: Mapped[str | None] = mapped_column(Text)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="test_runs")
    results: Mapped[list["TestResult"]] = relationship(
        "TestResult",
        back_populates="test_run",
        cascade="all, delete-orphan",
    )
    traces: Mapped[list["Trace"]] = relationship(
        "Trace",
        back_populates="test_run",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<TestRun(id={self.id}, status={self.status})>"


class TestResult(Base, UUIDMixin, TimestampMixin):
    """Result of a single test case."""

    __tablename__ = "test_results"

    test_run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("test_runs.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Test identification
    test_name: Mapped[str] = mapped_column(String(500), nullable=False)
    test_file: Mapped[str | None] = mapped_column(String(1000))
    test_suite: Mapped[str | None] = mapped_column(String(500))
    test_layer: Mapped[str] = mapped_column(String(50), default="frontend")

    # Status
    status: Mapped[TestResultStatus] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    # Error details
    error_message: Mapped[str | None] = mapped_column(Text)
    error_stack: Mapped[str | None] = mapped_column(Text)

    # Artifacts
    screenshot_path: Mapped[str | None] = mapped_column(String(1000))
    video_path: Mapped[str | None] = mapped_column(String(1000))
    trace_id: Mapped[str | None] = mapped_column(String(36))

    # Extra data
    extra_data: Mapped[dict | None] = mapped_column(JSON)

    # Relationships
    test_run: Mapped["TestRun"] = relationship("TestRun", back_populates="results")

    @property
    def result_metadata(self) -> dict | None:
        """Alias for extra_data — used by Pydantic serialization (avoids shadowing Base.metadata)."""
        return self.extra_data

    def __repr__(self) -> str:
        return f"<TestResult(id={self.id}, name={self.test_name}, status={self.status})>"
