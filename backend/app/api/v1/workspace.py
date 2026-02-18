"""Workspace router — manages per-project file workspaces inside the container.

Electron uploads a ZIP of the host project; the backend extracts it to
workspace/{project_id}/ so the test runner and scanner can use it without
needing a host-filesystem mount.
"""

from __future__ import annotations

import base64
import io
import logging
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter()

# Workspace root relative to /app (backend CWD inside Docker)
_WORKSPACE_ROOT = Path("workspace")


def _workspace_dir(project_id: str) -> Path:
    return _WORKSPACE_ROOT / project_id


def _safe_path(base: Path, rel: str) -> Path:
    """Resolve and validate that rel stays inside base (path traversal guard)."""
    resolved = (base / rel).resolve()
    base_resolved = base.resolve()
    if not str(resolved).startswith(str(base_resolved)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path traversal detected: {rel!r}",
        )
    return resolved


# ── Schemas ───────────────────────────────────────────────────────────────────


class WorkspaceSyncStatus(BaseModel):
    synced: bool
    file_count: int
    total_size_bytes: int
    last_synced_at: str | None


class FileUpsertRequest(BaseModel):
    path: str
    content_b64: str


class FileDeleteRequest(BaseModel):
    path: str


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _require_project(project_id: str, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.is_active == True)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _workspace_status(ws: Path) -> WorkspaceSyncStatus:
    if not ws.exists() or not ws.is_dir():
        return WorkspaceSyncStatus(
            synced=False, file_count=0, total_size_bytes=0, last_synced_at=None
        )
    files = list(ws.rglob("*"))
    file_list = [f for f in files if f.is_file()]
    total_size = sum(f.stat().st_size for f in file_list)
    last_mod = max((f.stat().st_mtime for f in file_list), default=None)
    last_synced = (
        datetime.fromtimestamp(last_mod, tz=timezone.utc).isoformat()
        if last_mod is not None
        else None
    )
    return WorkspaceSyncStatus(
        synced=len(file_list) > 0,
        file_count=len(file_list),
        total_size_bytes=total_size,
        last_synced_at=last_synced,
    )


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/{project_id}/workspace", response_model=WorkspaceSyncStatus)
async def get_workspace_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSyncStatus:
    """Return current workspace sync status for the project."""
    await _require_project(project_id, db)
    return _workspace_status(_workspace_dir(project_id))


@router.post("/{project_id}/workspace/upload", response_model=WorkspaceSyncStatus)
async def upload_workspace(
    project_id: str,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSyncStatus:
    """Upload a ZIP and extract it to workspace/{project_id}/.

    The existing workspace is replaced atomically: extract to a temp dir,
    then swap with the live dir.
    """
    await _require_project(project_id, db)

    ws = _workspace_dir(project_id)
    tmp = _WORKSPACE_ROOT / f"{project_id}.tmp"

    # Read ZIP content
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload"
        )

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            # Security: validate all paths before extracting
            for info in zf.infolist():
                name = info.filename
                # Reject absolute paths and upward traversal
                if name.startswith("/") or ".." in name:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unsafe path in ZIP: {name!r}",
                    )

            # Extract to temp directory
            tmp.mkdir(parents=True, exist_ok=True)
            zf.extractall(tmp)
    except zipfile.BadZipFile as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid ZIP: {exc}"
        ) from exc

    # Atomically swap: remove old workspace, rename tmp → ws
    if ws.exists():
        shutil.rmtree(ws)
    tmp.rename(ws)

    result = _workspace_status(ws)
    logger.info(
        "workspace: uploaded %d files (%d bytes) for project %s",
        result.file_count,
        result.total_size_bytes,
        project_id,
    )
    return result


@router.put("/{project_id}/workspace/files", response_model=WorkspaceSyncStatus)
async def upsert_workspace_file(
    project_id: str,
    body: FileUpsertRequest,
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSyncStatus:
    """Create or update a single file in the workspace (incremental sync)."""
    await _require_project(project_id, db)
    ws = _workspace_dir(project_id)

    target = _safe_path(ws, body.path)
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        data = base64.b64decode(body.content_b64)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 content: {exc}",
        ) from exc

    target.write_bytes(data)
    logger.debug("workspace: upserted %s for project %s", body.path, project_id)
    return _workspace_status(ws)


@router.delete("/{project_id}/workspace/files", response_model=WorkspaceSyncStatus)
async def delete_workspace_file(
    project_id: str,
    body: FileDeleteRequest,
    db: AsyncSession = Depends(get_db),
) -> WorkspaceSyncStatus:
    """Delete a single file from the workspace (incremental sync)."""
    await _require_project(project_id, db)
    ws = _workspace_dir(project_id)

    target = _safe_path(ws, body.path)
    if target.exists() and target.is_file():
        target.unlink()
        logger.debug("workspace: deleted %s for project %s", body.path, project_id)

    return _workspace_status(ws)


@router.delete("/{project_id}/workspace", status_code=status.HTTP_204_NO_CONTENT)
async def clear_workspace(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete the entire workspace directory for a project."""
    await _require_project(project_id, db)
    ws = _workspace_dir(project_id)
    if ws.exists():
        shutil.rmtree(ws)
        logger.info("workspace: cleared workspace for project %s", project_id)
