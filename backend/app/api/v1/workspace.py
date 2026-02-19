"""Workspace router — manages per-project file workspaces inside the container.

Electron uploads a ZIP of the host project; the backend extracts it to
workspace/{project_id}/ so the test runner and scanner can use it without
needing a host-filesystem mount.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter()

# Workspace root relative to /app (backend CWD inside Docker)
_WORKSPACE_ROOT = Path("workspace")

# Internal manifest file stored inside each workspace dir
_MANIFEST = ".testforge_manifest.json"
# Max files returned in status response (avoids huge payloads on repeated polls)
_MAX_FILE_LIST = 500

# Dirs/files excluded from manifest (internal artifacts)
_EXCLUDE_FROM_MANIFEST = {".testforge_venv", ".testforge_manifest.json", "__pycache__"}


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


# ── Manifest helpers ──────────────────────────────────────────────────────────


def _is_excluded(path: Path, ws: Path) -> bool:
    """Return True if any component of path (rel to ws) is in the exclude set."""
    try:
        parts = path.relative_to(ws).parts
    except ValueError:
        return False
    return bool(set(parts) & _EXCLUDE_FROM_MANIFEST)


def _write_manifest(ws: Path, files: list[str]) -> None:
    """Persist a sorted file list to the workspace manifest JSON."""
    data = {
        "files": sorted(files),
        "synced_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    try:
        (ws / _MANIFEST).write_text(json.dumps(data))
    except OSError as exc:
        logger.warning("workspace: could not write manifest: %s", exc)


def _read_manifest(ws: Path) -> list[str] | None:
    """Return the persisted file list from the manifest, or None if absent/invalid."""
    manifest_path = ws / _MANIFEST
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text())
        return data.get("files", [])
    except Exception:
        return None


# ── Schemas ───────────────────────────────────────────────────────────────────


class WorkspaceSyncStatus(BaseModel):
    synced: bool
    file_count: int
    total_size_bytes: int
    last_synced_at: str | None
    files: list[str] = []          # capped at _MAX_FILE_LIST; empty when not synced


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
            synced=False, file_count=0, total_size_bytes=0, last_synced_at=None, files=[]
        )

    manifest_files = _read_manifest(ws)

    if manifest_files is not None:
        # Fast path: use persisted manifest
        total_size = sum(
            (ws / f).stat().st_size
            for f in manifest_files
            if (ws / f).is_file()
        )
        manifest_path = ws / _MANIFEST
        try:
            last_synced = datetime.fromtimestamp(
                manifest_path.stat().st_mtime, tz=timezone.utc
            ).isoformat()
        except OSError:
            last_synced = None
        return WorkspaceSyncStatus(
            synced=len(manifest_files) > 0,
            file_count=len(manifest_files),
            total_size_bytes=total_size,
            last_synced_at=last_synced,
            files=manifest_files[:_MAX_FILE_LIST],
        )

    # Slow path: walk directory (fallback when no manifest exists)
    all_files = [
        f for f in ws.rglob("*")
        if f.is_file() and not _is_excluded(f, ws)
    ]
    total_size = sum(f.stat().st_size for f in all_files)
    last_mod = max((f.stat().st_mtime for f in all_files), default=None)
    last_synced = (
        datetime.fromtimestamp(last_mod, tz=timezone.utc).isoformat()
        if last_mod is not None
        else None
    )
    rel_files = sorted(str(f.relative_to(ws)) for f in all_files)
    return WorkspaceSyncStatus(
        synced=len(all_files) > 0,
        file_count=len(all_files),
        total_size_bytes=total_size,
        last_synced_at=last_synced,
        files=rel_files[:_MAX_FILE_LIST],
    )


# ── Pytest scaffold ───────────────────────────────────────────────────────────

_PYTEST_CFG_FILES = ("conftest.py", "pyproject.toml", "pytest.ini", "setup.cfg", "setup.py")
_PYTHON_DIRS = ("backend", "api", "server", "src", "app")


def _scaffold_pytest_if_needed(ws: Path) -> None:
    """Create minimal pytest infrastructure in the workspace container so the test
    runner can be detected even when the project has no pre-existing test config.

    This only writes inside the Docker workspace — the original project files are
    never modified. Creates:
      • {python_dir}/conftest.py       — marks the dir as pytest root
      • {python_dir}/pytest.ini        — minimal ini with asyncio_mode = auto
      • {python_dir}/tests/__init__.py — empty package so pytest discovers tests

    Already-present files are never overwritten.
    """
    # Locate the Python backend subdirectory (or use root if Python files exist there)
    python_dir: Path | None = None
    for sub in _PYTHON_DIRS:
        candidate = ws / sub
        if candidate.is_dir() and (candidate / "requirements.txt").exists():
            python_dir = candidate
            break
    # Fallback: root has requirements.txt
    if python_dir is None and (ws / "requirements.txt").exists():
        python_dir = ws

    if python_dir is None:
        return  # Not a Python project — nothing to scaffold

    # Already has pytest config — nothing to do
    for cfg in _PYTEST_CFG_FILES:
        if (python_dir / cfg).exists():
            return

    logger.info("workspace: scaffolding pytest config in %s", python_dir)

    # conftest.py — empty root conftest so pytest finds the root
    conftest = python_dir / "conftest.py"
    if not conftest.exists():
        conftest.write_text(
            "# Auto-generated by TestForge — add fixtures and configuration here\n"
        )

    # pytest.ini — minimal config
    pytest_ini = python_dir / "pytest.ini"
    if not pytest_ini.exists():
        pytest_ini.write_text(
            "[pytest]\n"
            "asyncio_mode = auto\n"
            "testpaths = tests\n"
        )

    # tests/ package — creates the test directory so pytest doesn't warn
    tests_dir = python_dir / "tests"
    tests_dir.mkdir(exist_ok=True)
    init_file = tests_dir / "__init__.py"
    if not init_file.exists():
        init_file.write_text(
            "# Auto-generated by TestForge — place your test files here\n"
        )


# ── Project structure analysis ────────────────────────────────────────────────

def _analyze_project_structure(ws: Path) -> dict[str, Any]:
    """Detect the tech stack of a synced workspace.

    Returns a structured dict describing backend type, frontend type,
    database engine, available config files and key entry points.
    """
    info: dict[str, Any] = {
        "backend": None, "frontend": None, "database": None,
        "has_docker": (ws / "docker-compose.yml").exists() or (ws / "docker-compose.yaml").exists(),
        "has_makefile": (ws / "Makefile").exists(),
    }

    # ── Backend detection ────────────────────────────────────────────────────
    for sub in ("backend", "api", "server", "src", "."):
        d = ws if sub == "." else ws / sub
        if not d.is_dir():
            continue
        reqs = d / "requirements.txt"
        if reqs.exists():
            text = reqs.read_text(errors="ignore").lower()
            btype = "fastapi" if "fastapi" in text else "django" if "django" in text else "flask" if "flask" in text else "python"
            db_type = "postgresql" if "asyncpg" in text or "psycopg" in text else "mysql" if "pymysql" in text or "mysqlclient" in text else "sqlite" if "sqlite" in text else None
            has_celery = "celery" in text
            # Read some source snippets for AI context
            entry = None
            for ep in ("main.py", "app.py", "wsgi.py", "asgi.py", "manage.py"):
                if (d / ep).exists():
                    entry = ep
                    break
            info["backend"] = {
                "type": btype, "dir": str(d.relative_to(ws)), "entry_point": entry,
                "has_celery": has_celery, "requirements_path": str(reqs.relative_to(ws)),
            }
            if db_type:
                info["database"] = {"type": db_type}
            break

    # ── Frontend detection ───────────────────────────────────────────────────
    for sub in ("frontend", "client", "web", "app", "."):
        d = ws if sub == "." else ws / sub
        if not d.is_dir():
            continue
        pkg = d / "package.json"
        if not pkg.exists():
            continue
        try:
            pdata = json.loads(pkg.read_text())
        except Exception:
            continue
        deps = {**pdata.get("dependencies", {}), **pdata.get("devDependencies", {})}
        ftype = (
            "nextjs" if "next" in deps else
            "react" if "react" in deps else
            "vue" if "vue" in deps else
            "angular" if "@angular/core" in deps else
            "nodejs"
        )
        has_playwright = "@playwright/test" in deps or "playwright" in deps
        has_vitest = "vitest" in deps
        has_jest = "jest" in deps
        scripts = pdata.get("scripts", {})
        info["frontend"] = {
            "type": ftype, "dir": str(d.relative_to(ws)),
            "has_playwright": has_playwright, "has_vitest": has_vitest, "has_jest": has_jest,
            "scripts": scripts,
        }
        break

    # ── DB detection from docker-compose ────────────────────────────────────
    if info["database"] is None:
        for dc_name in ("docker-compose.yml", "docker-compose.yaml", "docker-compose.dev.yml"):
            dc = ws / dc_name
            if dc.exists():
                dc_text = dc.read_text(errors="ignore").lower()
                if "postgres" in dc_text:
                    info["database"] = {"type": "postgresql"}
                elif "mysql" in dc_text or "mariadb" in dc_text:
                    info["database"] = {"type": "mysql"}
                elif "mongo" in dc_text:
                    info["database"] = {"type": "mongodb"}
                break

    return info


def _read_key_source_files(ws: Path, structure: dict[str, Any]) -> str:
    """Read up to 6 key source files and return them as a concatenated string for AI context."""
    candidates: list[Path] = []

    # Backend sources
    be = structure.get("backend")
    if be:
        bd = ws / be["dir"]
        if be.get("entry_point"):
            candidates.append(bd / be["entry_point"])
        for sub in ("api", "routers", "routes", "views"):
            d = bd / sub
            if d.is_dir():
                candidates.extend(sorted(d.rglob("*.py"))[:3])
                break
        for sub in ("models", "schemas", "db"):
            d = bd / sub
            if d.is_dir():
                candidates.extend(sorted(d.rglob("*.py"))[:2])
                break

    # Frontend sources
    fe = structure.get("frontend")
    if fe:
        fd = ws / fe["dir"]
        for sub in ("app", "pages", "src"):
            d = fd / sub
            if d.is_dir():
                candidates.extend(sorted(d.rglob("*.tsx"))[:2])
                break

    snippets: list[str] = []
    seen: set[Path] = set()
    for p in candidates:
        if not p.is_file() or p in seen or ".testforge_venv" in str(p):
            continue
        seen.add(p)
        try:
            content = p.read_text(errors="ignore")[:3000]
            rel = p.relative_to(ws)
            snippets.append(f"### {rel}\n```\n{content}\n```")
        except OSError:
            pass
        if len(snippets) >= 6:
            break

    return "\n\n".join(snippets)


_FILE_BLOCK_RE = re.compile(
    r"===FILE:\s*(.+?)\s*===\n(.*?)(?=\n===FILE:|\n===END===|$)",
    re.DOTALL,
)


async def _ai_generate_test_files(
    ws: Path,
    structure: dict[str, Any],
    run_id: str | None = None,
) -> list[str]:
    """Use the configured AI provider to generate test files for the project.

    Returns a list of relative paths of files written to the workspace.
    """
    from app.ai.providers import AIMessage, get_ai_provider

    be = structure.get("backend")
    fe = structure.get("frontend")
    db = structure.get("database")

    source_ctx = _read_key_source_files(ws, structure)

    # Build the generation prompt
    target_files: list[str] = []
    if be:
        bd = be["dir"]
        target_files += [
            f"{bd}/conftest.py — pytest fixtures (DB session, HTTP client, auth token if applicable)",
            f"{bd}/tests/__init__.py — empty package",
            f"{bd}/tests/test_api.py — API endpoint tests covering main routes",
        ]
        if db:
            target_files.append(f"{bd}/tests/test_database.py — DB model CRUD tests")
    if fe:
        fd = fe["dir"]
        target_files.append(f"{fd}/playwright.config.ts — Playwright configuration")
        target_files.append(f"{fd}/tests/e2e/home.spec.ts — E2E smoke tests for key pages")

    if not target_files:
        return []

    targets_str = "\n".join(f"  {i+1}. {t}" for i, t in enumerate(target_files))
    be_type = be["type"] if be else "python"
    fe_type = fe["type"] if fe else "none"
    db_type = db["type"] if db else "none"

    prompt = f"""You are a senior test engineer. Generate production-ready test files for this project.

TECH STACK:
- Backend: {be_type}
- Frontend: {fe_type}
- Database: {db_type}

KEY SOURCE FILES (for context):
{source_ctx if source_ctx else "(no source files available)"}

Generate the following files. For EACH file use EXACTLY this format:
===FILE: relative/path/to/file===
<file content here>
===END===

Files to generate:
{targets_str}

Rules:
- Use pytest + pytest-asyncio for Python tests
- Use async/await for all async tests
- Use httpx.AsyncClient as the HTTP client
- ALWAYS read the base URL from the BACKEND_URL environment variable:
    BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")
  (TestForge injects this env var, translated to host.docker.internal when needed)
- Use real assertions, not just `assert True`
- For Playwright: use TypeScript and read from FRONTEND_URL env var
- Keep tests focused and runnable without mocking
- Include at minimum 3 test functions per file
- Do NOT include explanatory text outside the ===FILE=== blocks
"""

    try:
        provider = get_ai_provider()
        messages = [
            AIMessage(role="system", content="You are a test engineer. Output ONLY ===FILE: path=== blocks, no other text."),
            AIMessage(role="user", content=prompt),
        ]
        response = await provider.generate(messages, temperature=0.2, max_tokens=4000)
        ai_text = response.content
    except Exception as exc:
        logger.warning("workspace: AI generation failed (%s) — using rule-based fallback", exc)
        ai_text = _rule_based_test_templates(structure)

    return _write_ai_files(ws, ai_text)


def _write_ai_files(ws: Path, ai_text: str) -> list[str]:
    """Parse ===FILE: path=== blocks from AI response and write them to the workspace."""
    written: list[str] = []
    ws_resolved = ws.resolve()

    for match in _FILE_BLOCK_RE.finditer(ai_text):
        rel_path = match.group(1).strip()
        content = match.group(2).rstrip()

        # Strip markdown code fence if present
        content = re.sub(r"^```[a-z]*\n?", "", content)
        content = re.sub(r"\n?```$", "", content)

        # Path traversal guard
        try:
            target = (ws / rel_path).resolve()
            if ws_resolved not in target.parents and target != ws_resolved:
                logger.warning("workspace: blocked unsafe AI path: %s", rel_path)
                continue
        except (ValueError, OSError):
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content + "\n")
        written.append(rel_path)
        logger.info("workspace: wrote AI-generated %s", rel_path)

    return written


def _rule_based_test_templates(structure: dict[str, Any]) -> str:
    """Fallback test templates when the AI provider is unavailable."""
    blocks: list[str] = []
    be = structure.get("backend")
    fe = structure.get("frontend")

    if be:
        bd = be["dir"]
        btype = be["type"]
        blocks.append(f"""===FILE: {bd}/conftest.py===
import os
import pytest
import httpx

# BACKEND_URL is injected by TestForge from the project config (and translated
# from localhost → host.docker.internal when running inside Docker).
BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")


@pytest.fixture
def base_url() -> str:
    return BASE_URL


@pytest.fixture
async def client():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as c:
        yield c
===END===

===FILE: {bd}/tests/__init__.py===
===END===

===FILE: {bd}/tests/test_api.py===
import os
import pytest
import httpx

pytestmark = pytest.mark.asyncio

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")


async def test_health_check():
    \"\"\"Verify the /health (or /api/health) endpoint returns 2xx.\"\"\"
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as client:
        for path in ("/health", "/api/health", "/api/v1/health"):
            resp = await client.get(path)
            if resp.status_code < 400:
                assert resp.status_code < 400
                return
    pytest.skip("No reachable health endpoint found")


async def test_api_docs_accessible():
    \"\"\"OpenAPI docs should be publicly accessible.\"\"\"
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as client:
        resp = await client.get("/docs")
    assert resp.status_code == 200


async def test_openapi_schema():
    \"\"\"OpenAPI schema must be valid JSON with the 'openapi' key.\"\"\"
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10) as client:
        resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    data = resp.json()
    assert "openapi" in data
===END===
""")

    if fe:
        fd = fe["dir"]
        blocks.append(f"""===FILE: {fd}/playwright.config.ts===
import {{ defineConfig }} from "@playwright/test";

export default defineConfig({{
  testDir: "./tests/e2e",
  timeout: 30_000,
  reporter: "json",
  use: {{
    baseURL: process.env.FRONTEND_URL || "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  }},
}});
===END===

===FILE: {fd}/tests/e2e/home.spec.ts===
import {{ test, expect }} from "@playwright/test";

test.describe("Home page", () => {{
  test("loads successfully", async ({{ page }}) => {{
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
  }});

  test("has a visible title or heading", async ({{ page }}) => {{
    await page.goto("/");
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
  }});

  test("has navigation links", async ({{ page }}) => {{
    await page.goto("/");
    const links = page.locator("nav a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
  }});
}});
===END===
""")

    return "\n".join(blocks)


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
            # Security: validate all paths before extracting (path traversal only)
            tmp_resolved = tmp.resolve()
            for info in zf.infolist():
                name = info.filename.rstrip("/")
                if not name:
                    continue
                if name.startswith("/"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Unsafe path in ZIP: {name!r}",
                    )
                try:
                    resolved = (tmp / name).resolve()
                    if tmp_resolved != resolved and tmp_resolved not in resolved.parents:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unsafe path in ZIP: {name!r}",
                        )
                except (ValueError, OSError):
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

    # Preserve the isolated venv across workspace swaps so the next test run
    # doesn't need to reinstall dependencies (the hash check will handle
    # requirements changes — only reinstalls when requirements.txt changes).
    _venv_name = ".testforge_venv"
    _venv_stash = _WORKSPACE_ROOT / f"{project_id}.venv"
    venv_stashed = False
    if ws.exists():
        venv_src = ws / _venv_name
        if venv_src.exists():
            try:
                if _venv_stash.exists():
                    shutil.rmtree(_venv_stash)
                venv_src.rename(_venv_stash)   # O(1) on same volume
                venv_stashed = True
            except OSError:
                pass  # can't save — venv will rebuild on next run
        shutil.rmtree(ws)
    tmp.rename(ws)

    # Restore the stashed venv into the new workspace
    if venv_stashed and _venv_stash.exists():
        try:
            _venv_stash.rename(ws / _venv_name)
            logger.info("workspace: restored venv for project %s (deps cached)", project_id)
        except OSError:
            pass  # restore failed — venv will rebuild harmlessly

    # Scaffold minimal pytest infrastructure if the project needs it
    _scaffold_pytest_if_needed(ws)

    # Write manifest so subsequent status calls are fast and the file list persists
    extracted_files = sorted(
        str(f.relative_to(ws))
        for f in ws.rglob("*")
        if f.is_file() and not _is_excluded(f, ws)
    )
    _write_manifest(ws, extracted_files)

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

    # Keep manifest in sync
    manifest_files = _read_manifest(ws) or []
    if body.path not in manifest_files:
        manifest_files.append(body.path)
    _write_manifest(ws, manifest_files)

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

        # Keep manifest in sync
        manifest_files = _read_manifest(ws) or []
        if body.path in manifest_files:
            manifest_files.remove(body.path)
        _write_manifest(ws, manifest_files)

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
    # Also remove the stashed venv (if any)
    venv_stash = _WORKSPACE_ROOT / f"{project_id}.venv"
    if venv_stash.exists():
        shutil.rmtree(venv_stash)


@router.post("/{project_id}/workspace/scaffold")
async def scaffold_project_tests(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Analyze the synced workspace, create test configs, and use AI to generate
    test files for backend, frontend, and database layers.

    All files are created inside the Docker container workspace — the original
    project on the host is never modified.
    """
    await _require_project(project_id, db)
    ws = _workspace_dir(project_id)

    if not ws.exists() or not any(
        f for f in ws.iterdir() if f.name not in {".testforge_venv", ".testforge_manifest.json"}
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workspace not synced. Run 'Sync Now' first.",
        )

    # 1. Analyse tech stack
    structure = _analyze_project_structure(ws)
    logger.info("workspace: detected structure for %s: %s", project_id, structure)

    # 2. Scaffold static configs (pytest.ini, conftest.py skeleton, etc.)
    _scaffold_pytest_if_needed(ws)

    # 3. AI-generate test files
    ai_files = await _ai_generate_test_files(ws, structure)

    # 4. Update manifest
    all_files = sorted(
        str(f.relative_to(ws))
        for f in ws.rglob("*")
        if f.is_file() and not _is_excluded(f, ws)
    )
    _write_manifest(ws, all_files)

    # 5. Return file contents so the frontend can write them to the host project
    created_files_with_content: list[dict[str, str]] = []
    for rel in ai_files:
        p = ws / rel
        try:
            content = p.read_text(encoding="utf-8") if p.is_file() else ""
        except OSError:
            content = ""
        created_files_with_content.append({"path": rel, "content": content})

    return {
        "structure": structure,
        "created_files": ai_files,                          # backward-compat list of paths
        "created_files_with_content": created_files_with_content,
        "total_files": len(all_files),
    }


@router.get("/{project_id}/workspace/download")
async def download_workspace(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Download the entire workspace (excluding .testforge_venv) as a ZIP archive."""
    await _require_project(project_id, db)
    ws = _workspace_dir(project_id)

    if not ws.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found. Run 'Sync Now' first.",
        )

    buf = io.BytesIO()
    excluded = {".testforge_venv", ".testforge_manifest.json"}

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in ws.rglob("*"):
            if not f.is_file():
                continue
            parts = set(f.relative_to(ws).parts)
            if parts & excluded:
                continue
            try:
                zf.write(f, f.relative_to(ws))
            except OSError:
                pass

    buf.seek(0)
    filename = f"testforge-workspace-{project_id[:8]}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
