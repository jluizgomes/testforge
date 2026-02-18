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

    @model_validator(mode="before")
    @classmethod
    def _mask_sensitive_fields(cls, data: Any) -> Any:
        """Decrypt then mask sensitive fields for API responses."""
        # Handle both ORM objects and dicts
        if hasattr(data, "__dict__"):
            # ORM object — work on a copy of attributes
            password = getattr(data, "test_login_password", None)
            if password:
                decrypted = decrypt_value(password)
                data.test_login_password = mask_for_display(decrypted)

            db_url = getattr(data, "database_url", None)
            if db_url:
                decrypted_url = decrypt_value(db_url)
                data.database_url = mask_url(decrypted_url)
        elif isinstance(data, dict):
            password = data.get("test_login_password")
            if password:
                decrypted = decrypt_value(password)
                data["test_login_password"] = mask_for_display(decrypted)

            db_url = data.get("database_url")
            if db_url:
                decrypted_url = decrypt_value(db_url)
                data["database_url"] = mask_url(decrypted_url)

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
