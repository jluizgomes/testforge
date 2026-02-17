"""Project scanner — discovers entry points and generates AI test suggestions."""

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import async_session_factory, get_db
from app.models.project import Project
from app.models.scanner import GeneratedTest, ScanJob, ScanJobStatus

logger = logging.getLogger(__name__)

router = APIRouter()

# Extensions considered "interesting" for test generation
_ENTRY_POINT_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java"}
_SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next"}
_ROUTE_PATTERNS = [
    re.compile(r"(router|Route|app)\.(get|post|put|delete|patch)\s*\("),  # Express / FastAPI
    re.compile(r"export\s+default\s+function\s+\w+Page"),                 # Next.js page
    re.compile(r"@router\.(get|post|put|delete|patch)\s*\("),             # FastAPI router decorator
    re.compile(r"createBrowserRouter|<Route\s"),                           # React Router
]


# ── Schemas ───────────────────────────────────────────────────────────────────


class ScanRequest(BaseModel):
    project_id: str
    pre_discovered_structure: dict[str, Any] | None = None  # From Electron pre-scan


class ScanStatusResponse(BaseModel):
    job_id: str
    status: ScanJobStatus
    progress: int
    files_found: int
    entry_points_found: int
    tests_generated: int
    error_message: str | None = None


class GeneratedTestResponse(BaseModel):
    id: str
    scan_job_id: str
    project_id: str
    test_name: str
    test_code: str
    test_type: str
    entry_point: str | None
    accepted: bool
    created_at: str

    class Config:
        from_attributes = True


class AcceptTestRequest(BaseModel):
    accepted: bool


# ── Background scan task ──────────────────────────────────────────────────────


def _find_entry_points_from_fs(project_path: str, max_files: int = 200) -> list[dict[str, Any]]:
    """Walk the project filesystem and identify interesting entry-point files."""
    root = Path(project_path)
    if not root.exists():
        return []

    entry_points: list[dict[str, Any]] = []
    scanned = 0

    for file_path in root.rglob("*"):
        if scanned >= max_files:
            break
        if any(skip in file_path.parts for skip in _SKIP_DIRS):
            continue
        if not file_path.is_file():
            continue
        if file_path.suffix not in _ENTRY_POINT_EXTENSIONS:
            continue

        scanned += 1
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            is_entry = any(p.search(content) for p in _ROUTE_PATTERNS)
            if is_entry or "export default" in content or "class " in content:
                entry_points.append({
                    "path": str(file_path.relative_to(root)),
                    "content_preview": content[:800],
                    "extension": file_path.suffix,
                })
        except Exception:
            pass

    return entry_points


def _find_entry_points_from_structure(structure: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract entry points from a pre-discovered structure (sent by Electron)."""
    entry_points = []
    for ep in structure.get("entry_points", []):
        if isinstance(ep, str):
            entry_points.append({"path": ep, "content_preview": "", "extension": Path(ep).suffix})
        elif isinstance(ep, dict):
            entry_points.append(ep)
    return entry_points


async def _run_scan(job_id: str, project_path: str, structure: dict[str, Any] | None) -> None:
    """Background task: scan project and generate test suggestions via AI."""
    async with async_session_factory() as db:
        try:
            # Load job
            result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
            job = result.scalar_one_or_none()
            if not job:
                return

            # ── Phase 1: Discover entry points ───────────────────────────────
            job.status = ScanJobStatus.SCANNING
            job.progress = 10
            await db.commit()

            if structure:
                # Backend doesn't need filesystem access — use pre-discovered data
                entry_points = _find_entry_points_from_structure(structure)
                job.files_found = structure.get("total_files", len(entry_points))
            else:
                entry_points = _find_entry_points_from_fs(project_path)
                job.files_found = len(entry_points)

            job.entry_points_found = len(entry_points)
            job.progress = 30
            await db.commit()

            # ── Phase 2: Generate tests via AI ───────────────────────────────
            job.status = ScanJobStatus.GENERATING
            await db.commit()

            from app.ai.agents.test_generator import TestGeneratorAgent
            from app.ai.providers import get_ai_provider
            from app.ai.rag.retriever import RAGRetriever

            try:
                provider = get_ai_provider()
                retriever = RAGRetriever()
                agent = TestGeneratorAgent(provider=provider, retriever=retriever)
            except Exception as exc:
                logger.warning("AI provider unavailable for scan: %s", exc)
                agent = None

            batch = entry_points[:10]  # Limit to 10 to avoid long waits
            generated_count = 0

            for idx, ep in enumerate(batch):
                path = ep.get("path", "unknown")
                preview = ep.get("content_preview", "")
                ext = ep.get("extension", "")

                test_type = "api" if ext == ".py" else "e2e"
                prompt = (
                    f"Generate tests for this file: {path}\n"
                    f"Content preview:\n{preview[:400]}"
                )

                if agent:
                    try:
                        result_ai = await asyncio.wait_for(
                            agent.generate(
                                prompt=prompt,
                                project_id=job.project_id,
                                test_type=test_type,
                            ),
                            timeout=45.0,
                        )
                        tests = result_ai.get("tests", [])
                    except Exception as exc:
                        logger.debug("AI generation failed for %s: %s", path, exc)
                        tests = [_template_for(path, test_type)]
                else:
                    tests = [_template_for(path, test_type)]

                for code in tests[:1]:  # One test per entry point
                    gt = GeneratedTest(
                        scan_job_id=job_id,
                        project_id=job.project_id,
                        test_name=f"Test: {Path(path).stem}",
                        test_code=code,
                        test_type=test_type,
                        entry_point=path,
                        accepted=False,
                    )
                    db.add(gt)
                    generated_count += 1

                job.progress = 30 + int((idx + 1) / len(batch) * 60)
                job.tests_generated = generated_count
                await db.commit()

            job.status = ScanJobStatus.COMPLETED
            job.progress = 100
            job.tests_generated = generated_count
            await db.commit()

        except Exception as exc:
            logger.exception("Scan job %s failed: %s", job_id, exc)
            async with async_session_factory() as error_db:
                err_result = await error_db.execute(select(ScanJob).where(ScanJob.id == job_id))
                err_job = err_result.scalar_one_or_none()
                if err_job:
                    err_job.status = ScanJobStatus.FAILED
                    err_job.error_message = str(exc)
                    await error_db.commit()


def _template_for(path: str, test_type: str) -> str:
    """Return a starter test template for a given file."""
    name = Path(path).stem
    if test_type == "api":
        return f"""import pytest
import httpx

# Auto-generated starter test for: {path}

@pytest.mark.asyncio
async def test_{name.lower().replace("-", "_")}():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        response = await client.get("/")
        assert response.status_code == 200
"""
    return f"""import {{ test, expect }} from '@playwright/test'

// Auto-generated starter test for: {path}

test.describe('{name}', () => {{
  test('should render correctly', async ({{ page }}) => {{
    await page.goto('/')
    await expect(page.locator('[data-testid="{name.lower()}"]')).toBeVisible()
  }})
}})
"""


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("", response_model=ScanStatusResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(
    request: ScanRequest,
    db: AsyncSession = Depends(get_db),
) -> ScanJob:
    """Start a background scan of the project to discover entry points and generate tests."""
    # Verify project exists
    proj_result = await db.execute(
        select(Project).where(Project.id == request.project_id, Project.is_active == True)
    )
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Create scan job
    job = ScanJob(
        project_id=request.project_id,
        status=ScanJobStatus.PENDING,
        progress=0,
        discovered_structure=request.pre_discovered_structure,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Fire background task (non-blocking)
    asyncio.create_task(
        _run_scan(
            job_id=job.id,
            project_path=project.path,
            structure=request.pre_discovered_structure,
        )
    )

    return job


@router.get("/status/{job_id}", response_model=ScanStatusResponse)
async def get_scan_status(
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> ScanJob:
    """Get the current status of a scan job."""
    result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan job not found")

    return job


@router.get("/generated-tests/{project_id}", response_model=list[GeneratedTestResponse])
async def list_generated_tests(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[GeneratedTest]:
    """List AI-generated test suggestions for a project."""
    result = await db.execute(
        select(GeneratedTest)
        .where(GeneratedTest.project_id == project_id)
        .order_by(GeneratedTest.created_at.desc())
    )
    return list(result.scalars().all())


@router.patch("/generated-tests/{test_id}", response_model=GeneratedTestResponse)
async def update_generated_test(
    test_id: str,
    body: AcceptTestRequest,
    db: AsyncSession = Depends(get_db),
) -> GeneratedTest:
    """Accept or reject a generated test suggestion."""
    result = await db.execute(select(GeneratedTest).where(GeneratedTest.id == test_id))
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated test not found")

    test.accepted = body.accepted
    await db.commit()
    await db.refresh(test)
    return test
