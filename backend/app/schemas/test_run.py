"""Pydantic schemas for TestRun."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.models.test_run import TestResultStatus, TestRunStatus


class TestRunCreate(BaseModel):
    """Schema for creating a test run."""

    config: dict[str, Any] | None = None


class TestRunUpdate(BaseModel):
    """Schema for updating a test run."""

    status: TestRunStatus | None = None
    total_tests: int | None = None
    passed_tests: int | None = None
    failed_tests: int | None = None
    skipped_tests: int | None = None
    duration_ms: int | None = None
    error_message: str | None = None


class TestResultResponse(BaseModel):
    """Schema for test result response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    test_run_id: str
    test_name: str
    test_file: str | None
    test_suite: str | None
    test_layer: str
    status: TestResultStatus
    duration_ms: int | None
    error_message: str | None
    error_stack: str | None
    screenshot_path: str | None
    video_path: str | None
    trace_id: str | None
    metadata: dict | None
    created_at: datetime


class TestRunResponse(BaseModel):
    """Schema for test run response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    status: TestRunStatus
    started_at: datetime | None
    completed_at: datetime | None
    total_tests: int
    passed_tests: int
    failed_tests: int
    skipped_tests: int
    duration_ms: int | None
    config: dict | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    results: list[TestResultResponse] | None = None
