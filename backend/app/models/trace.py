"""Trace models for distributed tracing."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.test_run import TestRun


class Trace(Base, UUIDMixin, TimestampMixin):
    """A distributed trace for a test execution."""

    __tablename__ = "traces"

    test_run_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("test_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    trace_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)

    # Timing
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    # Root operation
    root_service: Mapped[str] = mapped_column(String(100), nullable=False)
    root_operation: Mapped[str] = mapped_column(String(500), nullable=False)

    # Status
    status: Mapped[str] = mapped_column(String(20), default="ok")
    error_message: Mapped[str | None] = mapped_column(String(2000))

    # Metadata
    attributes: Mapped[dict | None] = mapped_column(JSON)

    # Relationships
    test_run: Mapped["TestRun"] = relationship("TestRun", back_populates="traces")
    spans: Mapped[list["Span"]] = relationship(
        "Span",
        back_populates="trace",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Trace(id={self.id}, trace_id={self.trace_id})>"


class Span(Base, UUIDMixin, TimestampMixin):
    """A single span within a trace."""

    __tablename__ = "spans"

    trace_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("traces.id", ondelete="CASCADE"),
        nullable=False,
    )
    span_id: Mapped[str] = mapped_column(String(36), nullable=False)
    parent_span_id: Mapped[str | None] = mapped_column(String(36))

    # Operation
    service: Mapped[str] = mapped_column(String(100), nullable=False)
    operation: Mapped[str] = mapped_column(String(500), nullable=False)

    # Timing
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    # Status
    status: Mapped[str] = mapped_column(String(20), default="ok")
    error_message: Mapped[str | None] = mapped_column(String(2000))

    # Context
    attributes: Mapped[dict | None] = mapped_column(JSON)
    events: Mapped[list | None] = mapped_column(JSON)

    # Relationships
    trace: Mapped["Trace"] = relationship("Trace", back_populates="spans")

    def __repr__(self) -> str:
        return f"<Span(id={self.id}, operation={self.operation})>"
