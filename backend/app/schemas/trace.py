"""Pydantic schemas for Trace."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SpanResponse(BaseModel):
    """Schema for span response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    span_id: str
    parent_span_id: str | None
    service: str
    operation: str
    start_time: datetime
    end_time: datetime
    duration_ms: int
    status: str
    error_message: str | None
    attributes: dict | None
    events: list | None


class TraceResponse(BaseModel):
    """Schema for trace response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    test_run_id: str
    trace_id: str
    start_time: datetime
    end_time: datetime | None
    duration_ms: int | None
    root_service: str
    root_operation: str
    status: str
    error_message: str | None
    attributes: dict | None
    created_at: datetime
    spans: list[SpanResponse] | None = None
