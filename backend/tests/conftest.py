"""Shared pytest fixtures for TestForge backend tests."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security.auth import get_current_user
from app.db.session import get_db
from app.main import app


@pytest.fixture(autouse=True)
def disable_auth():
    """Disable JWT authentication for all tests by default."""
    app.dependency_overrides[get_current_user] = lambda: None
    yield
    app.dependency_overrides.pop(get_current_user, None)


# ── Database mock helpers ─────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_project(
    *,
    name: str = "Test Project",
    path: str = "/test/path",
    description: str | None = None,
    is_active: bool = True,
    has_config: bool = False,
) -> MagicMock:
    """Create a mock Project ORM object with all required fields."""
    p = MagicMock()
    p.id = str(uuid4())
    p.name = name
    p.path = path
    p.description = description
    p.is_active = is_active
    p.created_at = _now()
    p.updated_at = _now()
    p.config = make_project_config(project_id=p.id) if has_config else None
    p.test_runs = []
    return p


def make_project_config(*, project_id: str | None = None) -> MagicMock:
    """Create a mock ProjectConfig ORM object."""
    c = MagicMock()
    c.id = str(uuid4())
    c.project_id = project_id or str(uuid4())
    c.frontend_url = "http://localhost:3000"
    c.backend_url = "http://localhost:8000"
    c.openapi_url = None
    c.database_url = "postgresql://user:pass@localhost/db"
    c.redis_url = None
    c.playwright_config = None
    c.test_timeout = 30000
    c.parallel_workers = 1
    c.retry_count = 0
    c.test_login_email = None
    c.test_login_password = None
    c.ai_provider = None
    c.ai_model = None
    c.created_at = _now()
    c.updated_at = _now()
    return c


@pytest.fixture
def mock_db() -> MagicMock:
    """Return a mock async SQLAlchemy session."""
    session = MagicMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    async def _flush() -> None:
        """Simulate flush by setting defaults on tracked objects."""
        for call_args in session.add.call_args_list:
            obj = call_args[0][0] if call_args[0] else None
            if obj is None:
                continue
            if getattr(obj, "id", None) is None:
                try:
                    obj.id = str(uuid4())
                except Exception:
                    pass
            if hasattr(obj, "is_active") and getattr(obj, "is_active", None) is None:
                try:
                    obj.is_active = True
                except Exception:
                    pass
            if getattr(obj, "created_at", None) is None:
                try:
                    obj.created_at = _now()
                except Exception:
                    pass
            if getattr(obj, "updated_at", None) is None:
                try:
                    obj.updated_at = _now()
                except Exception:
                    pass

    session.flush = AsyncMock(side_effect=_flush)
    session.commit = AsyncMock()
    session.delete = AsyncMock()

    # refresh sets timestamps and defaults on the object (mimics DB roundtrip)
    async def _refresh(obj: object) -> None:
        if getattr(obj, "id", None) is None:
            try:
                obj.id = str(uuid4())  # type: ignore[attr-defined]
            except Exception:
                pass
        if getattr(obj, "is_active", None) is None:
            try:
                obj.is_active = True  # type: ignore[attr-defined]
            except Exception:
                pass
        if getattr(obj, "created_at", None) is None:
            try:
                obj.created_at = _now()  # type: ignore[attr-defined]
            except Exception:
                pass
        if getattr(obj, "updated_at", None) is None:
            try:
                obj.updated_at = _now()  # type: ignore[attr-defined]
            except Exception:
                pass

    session.refresh = AsyncMock(side_effect=_refresh)
    return session


@pytest.fixture
async def client(mock_db: MagicMock) -> AsyncGenerator[AsyncClient, None]:
    """HTTP test client with mocked database dependency."""

    async def override_get_db() -> AsyncGenerator:
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()
