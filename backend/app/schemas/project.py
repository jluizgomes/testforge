"""Pydantic schemas for Project."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectConfigBase(BaseModel):
    """Base schema for project configuration."""

    frontend_url: str | None = None
    backend_url: str | None = None
    openapi_url: str | None = None
    database_url: str | None = None
    redis_url: str | None = None
    playwright_config: dict | None = None
    test_timeout: int = 30000
    parallel_workers: int = 1
    retry_count: int = 0
    test_login_email: str | None = None
    test_login_password: str | None = None
    ai_provider: str | None = None
    ai_model: str | None = None


class ProjectConfigCreate(ProjectConfigBase):
    """Schema for creating a project configuration."""

    pass


class ProjectConfigUpdate(BaseModel):
    """Schema for updating a project configuration."""

    frontend_url: str | None = None
    backend_url: str | None = None
    openapi_url: str | None = None
    database_url: str | None = None
    redis_url: str | None = None
    playwright_config: dict | None = None
    test_timeout: int | None = None
    parallel_workers: int | None = None
    retry_count: int | None = None
    test_login_email: str | None = None
    test_login_password: str | None = None
    ai_provider: str | None = None
    ai_model: str | None = None


class ProjectConfigResponse(ProjectConfigBase):
    """Schema for project configuration response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime


class ProjectBase(BaseModel):
    """Base schema for Project."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    path: str = Field(..., min_length=1, max_length=1000)


class ProjectCreate(ProjectBase):
    """Schema for creating a project."""

    config: ProjectConfigCreate | None = None


class ProjectUpdate(BaseModel):
    """Schema for updating a project."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    path: str | None = Field(None, min_length=1, max_length=1000)
    is_active: bool | None = None
    config: ProjectConfigUpdate | None = None


class ProjectResponse(ProjectBase):
    """Schema for project response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    config: ProjectConfigResponse | None = None
