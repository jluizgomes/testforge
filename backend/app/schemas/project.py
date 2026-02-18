"""Pydantic schemas for Project."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.security.encryption import decrypt_value, mask_for_display
from app.core.security.masking import mask_url


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
    browser: str | None = None
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
    browser: str | None = None
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

    @model_validator(mode="before")
    @classmethod
    def _mask_sensitive_fields(cls, data: Any) -> Any:
        """Decrypt then mask sensitive fields for API responses. Returns a dict to avoid mutating ORM."""
        def mask_pw(val: Any) -> str | None:
            if val is None:
                return None
            if not isinstance(val, str):
                return None
            dec = decrypt_value(val)
            return mask_for_display(dec) if dec is not None else None

        def mask_db(val: Any) -> str | None:
            if val is None:
                return None
            if not isinstance(val, str):
                return None
            dec = decrypt_value(val)
            return mask_url(dec) if dec is not None else None

        if hasattr(data, "__dict__"):
            # ORM — build dict so we don't mutate the instance
            return {
                "id": str(getattr(data, "id", "")),
                "project_id": str(getattr(data, "project_id", "")),
                "created_at": getattr(data, "created_at", None),
                "updated_at": getattr(data, "updated_at", None),
                "frontend_url": getattr(data, "frontend_url", None),
                "backend_url": getattr(data, "backend_url", None),
                "openapi_url": getattr(data, "openapi_url", None),
                "database_url": mask_db(getattr(data, "database_url", None)),
                "redis_url": getattr(data, "redis_url", None),
                "playwright_config": getattr(data, "playwright_config", None),
                "test_timeout": getattr(data, "test_timeout", 30000),
                "parallel_workers": getattr(data, "parallel_workers", 1),
                "retry_count": getattr(data, "retry_count", 0),
                "browser": getattr(data, "browser", None),
                "test_login_email": getattr(data, "test_login_email", None),
                "test_login_password": mask_pw(getattr(data, "test_login_password", None)),
                "ai_provider": getattr(data, "ai_provider", None),
                "ai_model": getattr(data, "ai_model", None),
            }
        if isinstance(data, dict):
            password = data.get("test_login_password")
            if password is not None:
                data = {**data, "test_login_password": mask_pw(password)}
            db_url = data.get("database_url")
            if db_url is not None:
                data = {**data, "database_url": mask_db(db_url)}
        return data


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
