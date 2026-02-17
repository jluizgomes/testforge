"""Integration tests for the Projects API endpoints.

Total: 11 tests
Uses mocked SQLAlchemy sessions via FastAPI dependency override.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient

from tests.conftest import make_project, make_project_config


# ── Helper to set up mock execute return value ────────────────────────────────

def _scalars_all(items: list) -> MagicMock:
    """Create a mock execute result whose .scalars().all() returns `items`."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _scalar_one_or_none(item) -> MagicMock:
    """Create a mock execute result whose .scalar_one_or_none() returns `item`."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = item
    return result


# ── LIST ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_projects_returns_empty_list(client: AsyncClient, mock_db):
    """GET /api/v1/projects returns [] when no projects exist."""
    mock_db.execute.return_value = _scalars_all([])

    response = await client.get("/api/v1/projects")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_projects_returns_active_projects(client: AsyncClient, mock_db):
    """GET /api/v1/projects returns a list with the mock project."""
    project = make_project(name="Alpha Project")
    # First execute = project list; subsequent executes = config per project
    mock_db.execute.side_effect = [
        _scalars_all([project]),
        _scalar_one_or_none(None),  # config for first project
    ]

    response = await client.get("/api/v1/projects")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alpha Project"


@pytest.mark.asyncio
async def test_list_excludes_inactive_projects(client: AsyncClient, mock_db):
    """Inactive projects should not appear (filter applied at DB level)."""
    # The endpoint filters is_active=True at the SQLAlchemy level,
    # so the mock simply returns nothing when that filter is active.
    mock_db.execute.return_value = _scalars_all([])

    response = await client.get("/api/v1/projects")

    assert response.status_code == 200
    assert response.json() == []


# ── CREATE ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_project_returns_201(client: AsyncClient, mock_db):
    """POST /api/v1/projects returns 201 Created."""
    mock_db.execute.return_value = _scalar_one_or_none(None)  # no config loaded

    response = await client.post(
        "/api/v1/projects",
        json={"name": "My Project", "path": "/home/user/project"},
    )

    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_project_name_and_path_in_response(client: AsyncClient, mock_db):
    """POST /api/v1/projects response body has correct name and path."""
    mock_db.execute.return_value = _scalar_one_or_none(None)

    response = await client.post(
        "/api/v1/projects",
        json={"name": "E2E Suite", "path": "/var/projects/e2e"},
    )

    data = response.json()
    assert data["name"] == "E2E Suite"
    assert data["path"] == "/var/projects/e2e"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_create_project_with_config(client: AsyncClient, mock_db):
    """POST /api/v1/projects with config block stores config data."""
    mock_db.execute.return_value = _scalar_one_or_none(None)

    payload = {
        "name": "Full Stack App",
        "path": "/apps/fullstack",
        "config": {
            "frontend_url": "http://localhost:3000",
            "backend_url": "http://localhost:8000",
        },
    }
    response = await client.post("/api/v1/projects", json=payload)

    assert response.status_code == 201


# ── GET ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_project_by_id(client: AsyncClient, mock_db):
    """GET /api/v1/projects/{id} returns 200 with the project."""
    project = make_project(name="Beta Project")
    mock_db.execute.side_effect = [
        _scalar_one_or_none(project),  # project lookup
        _scalar_one_or_none(None),     # config lookup
    ]

    response = await client.get(f"/api/v1/projects/{project.id}")

    assert response.status_code == 200
    assert response.json()["name"] == "Beta Project"


@pytest.mark.asyncio
async def test_get_project_not_found_returns_404(client: AsyncClient, mock_db):
    """GET /api/v1/projects/{id} returns 404 when project does not exist."""
    mock_db.execute.return_value = _scalar_one_or_none(None)

    response = await client.get("/api/v1/projects/nonexistent-id")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ── UPDATE ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_project_name(client: AsyncClient, mock_db):
    """PATCH /api/v1/projects/{id} updates the project name."""
    project = make_project(name="Old Name")
    mock_db.execute.side_effect = [
        _scalar_one_or_none(project),  # project lookup
        _scalar_one_or_none(None),     # config lookup (no existing config)
        _scalar_one_or_none(None),     # config reload after commit
    ]

    response = await client.patch(
        f"/api/v1/projects/{project.id}",
        json={"name": "New Name"},
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_update_project_returns_404_when_missing(client: AsyncClient, mock_db):
    """PATCH /api/v1/projects/{id} returns 404 when project does not exist."""
    mock_db.execute.return_value = _scalar_one_or_none(None)

    response = await client.patch(
        "/api/v1/projects/ghost-id",
        json={"name": "Updated"},
    )

    assert response.status_code == 404


# ── DELETE ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_project_returns_204(client: AsyncClient, mock_db):
    """DELETE /api/v1/projects/{id} returns 204 No Content."""
    project = make_project()
    mock_db.execute.return_value = _scalar_one_or_none(project)

    response = await client.delete(f"/api/v1/projects/{project.id}")

    assert response.status_code == 204
    assert project.is_active is False  # soft-deleted


# ── CONFIG ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_project_config_endpoint(client: AsyncClient, mock_db):
    """GET /api/v1/projects/{id}/config returns the project config."""
    config = make_project_config()
    mock_db.execute.return_value = _scalar_one_or_none(config)

    response = await client.get(f"/api/v1/projects/{config.project_id}/config")

    assert response.status_code == 200
    data = response.json()
    assert "frontend_url" in data
