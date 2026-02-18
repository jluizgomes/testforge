"""Project scanner — discovers entry points and generates AI test suggestions."""

import asyncio
import logging
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory, get_db
from app.models.project import Project, ProjectConfig
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
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    status: ScanJobStatus
    progress: int
    files_found: int
    entry_points_found: int
    tests_generated: int
    error_message: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _map_id(cls, data: Any) -> Any:
        """Map ScanJob.id → job_id for the response schema."""
        if hasattr(data, "id"):
            return {
                "job_id": str(data.id),
                "status": data.status,
                "progress": data.progress,
                "files_found": data.files_found,
                "entry_points_found": data.entry_points_found,
                "tests_generated": data.tests_generated,
                "error_message": data.error_message,
            }
        return data


class GeneratedTestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scan_job_id: str
    project_id: str
    test_name: str
    test_code: str
    test_type: str
    entry_point: str | None
    accepted: bool
    created_at: datetime


class AcceptTestRequest(BaseModel):
    accepted: bool


# ── Helpers: project config & context ────────────────────────────────────────


async def _load_project_config(db: AsyncSession, project_id: str) -> ProjectConfig | None:
    """Load the ProjectConfig for a given project."""
    result = await db.execute(
        select(ProjectConfig).where(ProjectConfig.project_id == project_id)
    )
    return result.scalar_one_or_none()


def _read_dotenv_from_project(project_path: str) -> dict[str, str]:
    """Read .env / .env.local from the project filesystem (mounted volume)."""
    env: dict[str, str] = {}
    root = Path(project_path)
    for name in (".env", ".env.local"):
        path = root / name
        if path.is_file():
            try:
                parsed = dotenv_values(str(path))
                env.update({k: v for k, v in parsed.items() if v is not None})
            except Exception:
                pass
    return env


async def _fetch_openapi_spec(config: ProjectConfig | None) -> dict[str, Any] | None:
    """Fetch an OpenAPI spec from the project's configured URL."""
    if not config:
        return None

    openapi_url = config.openapi_url
    if not openapi_url and config.backend_url:
        openapi_url = f"{config.backend_url.rstrip('/')}/openapi.json"

    if not openapi_url:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(openapi_url)
            if resp.status_code == 200:
                return resp.json()
    except Exception as exc:
        logger.debug("Failed to fetch OpenAPI spec from %s: %s", openapi_url, exc)

    return None


def _resolve_schema_ref(schema: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    """Resolve a $ref in an OpenAPI schema (one level deep)."""
    ref = schema.get("$ref", "")
    if ref.startswith("#/components/schemas/"):
        name = ref.split("/")[-1]
        resolved = spec.get("components", {}).get("schemas", {}).get(name, {})
        return resolved
    return schema


def _parse_openapi_endpoints(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract endpoints with method, path, and request/response schemas."""
    endpoints: list[dict[str, Any]] = []
    paths = spec.get("paths", {})

    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, details in methods.items():
            if method not in ("get", "post", "put", "delete", "patch"):
                continue
            if not isinstance(details, dict):
                continue

            ep: dict[str, Any] = {
                "method": method.upper(),
                "path": path,
                "summary": details.get("summary", ""),
                "tags": details.get("tags", []),
            }

            # Request body schema
            req_body = details.get("requestBody", {})
            if isinstance(req_body, dict):
                content = req_body.get("content", {})
                json_ct = content.get("application/json", {})
                req_schema = json_ct.get("schema", {})
                if req_schema:
                    ep["request_schema"] = _resolve_schema_ref(req_schema, spec)

            # Response schema (200/201)
            responses = details.get("responses", {})
            for code in ("200", "201"):
                resp = responses.get(code, {})
                if isinstance(resp, dict):
                    content = resp.get("content", {})
                    json_ct = content.get("application/json", {})
                    resp_schema = json_ct.get("schema", {})
                    if resp_schema:
                        ep["response_schema"] = _resolve_schema_ref(resp_schema, spec)
                        break

            endpoints.append(ep)

    return endpoints


def _filter_relevant_endpoints(
    endpoints: list[dict[str, Any]],
    entry_point_path: str,
) -> list[dict[str, Any]]:
    """Filter endpoints relevant to an entry point file based on tags/path similarity."""
    stem = Path(entry_point_path).stem.lower().replace("_", "").replace("-", "")

    relevant = []
    for ep in endpoints:
        # Match by tags
        tags = [t.lower().replace("_", "").replace("-", "") for t in ep.get("tags", [])]
        ep_path = ep["path"].lower().replace("_", "").replace("-", "")

        if any(stem in tag or tag in stem for tag in tags):
            relevant.append(ep)
        elif stem in ep_path or ep_path.split("/")[-1] in stem:
            relevant.append(ep)

    return relevant if relevant else endpoints[:5]  # Fallback: first 5 endpoints


def _group_entry_points(
    entry_points: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Group entry points by directory/module to avoid generating repetitive tests."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ep in entry_points:
        path = ep.get("path", "unknown")
        parts = Path(path).parts
        # Group by first meaningful directory
        if len(parts) >= 2:
            group_key = parts[0] if parts[0] not in ("src", "app", "lib") else "/".join(parts[:2])
        else:
            group_key = "root"
        groups[group_key].append(ep)
    return dict(groups)


def _build_rich_prompt(
    entry_points: list[dict[str, Any]],
    group_name: str,
    config: ProjectConfig | None,
    env_vars: dict[str, str],
    openapi_endpoints: list[dict[str, Any]] | None,
    test_type: str,
) -> str:
    """Build a rich, contextualized prompt with real URLs, credentials, and endpoints."""
    sections: list[str] = []

    # Header
    sections.append(f"Generate DISTINCT {test_type} tests for the module/group: {group_name}")
    sections.append(f"Number of source files in this group: {len(entry_points)}")

    # Project URLs
    if config:
        url_lines = []
        if config.frontend_url:
            url_lines.append(f"  Frontend URL: {config.frontend_url}")
        if config.backend_url:
            url_lines.append(f"  Backend/API URL: {config.backend_url}")
        if config.database_url:
            url_lines.append(f"  Database URL: {config.database_url}")
        if url_lines:
            sections.append("Project URLs (use these in tests):\n" + "\n".join(url_lines))

    # Test credentials
    if config and (config.test_login_email or config.test_login_password):
        cred_lines = []
        if config.test_login_email:
            cred_lines.append(f"  Email: {config.test_login_email}")
        if config.test_login_password:
            cred_lines.append(f"  Password: {config.test_login_password}")
        sections.append("Test Login Credentials (use these for auth tests):\n" + "\n".join(cred_lines))

    # Environment variables (selected safe ones)
    safe_env = {
        k: v for k, v in env_vars.items()
        if not any(secret in k.lower() for secret in ("secret", "key", "token", "password"))
    }
    if safe_env:
        env_lines = [f"  {k}={v}" for k, v in list(safe_env.items())[:10]]
        sections.append("Environment variables available:\n" + "\n".join(env_lines))

    # OpenAPI endpoints
    if openapi_endpoints:
        ep_lines = []
        for ep in openapi_endpoints[:15]:
            line = f"  {ep['method']} {ep['path']}"
            if ep.get("summary"):
                line += f" — {ep['summary']}"
            if ep.get("request_schema"):
                props = ep["request_schema"].get("properties", {})
                if props:
                    fields = ", ".join(list(props.keys())[:6])
                    line += f"\n    Request fields: {fields}"
            if ep.get("response_schema"):
                props = ep["response_schema"].get("properties", {})
                if props:
                    fields = ", ".join(list(props.keys())[:6])
                    line += f"\n    Response fields: {fields}"
            ep_lines.append(line)
        sections.append("Available API Endpoints (from OpenAPI spec):\n" + "\n".join(ep_lines))

    # Source files
    file_lines = []
    for ep in entry_points:
        path = ep.get("path", "unknown")
        preview = ep.get("content_preview", "")
        if preview:
            file_lines.append(f"--- {path} ---\n{preview[:600]}")
        else:
            file_lines.append(f"--- {path} ---")
    sections.append("Source files:\n" + "\n\n".join(file_lines))

    # Instructions
    sections.append(
        "IMPORTANT RULES:\n"
        "- Generate ONE distinct test per source file or endpoint shown above\n"
        "- Each test MUST test a DIFFERENT scenario/feature\n"
        "- Use the REAL URLs and credentials provided above, NOT localhost:8000 or placeholder values\n"
        "- Each code block must be a complete, runnable test file\n"
        "- Separate each test with a code block (```typescript or ```python)"
    )

    return "\n\n".join(sections)


# ── Background scan task ──────────────────────────────────────────────────────


def _find_entry_points_from_fs(project_path: str, max_files: int = 500) -> list[dict[str, Any]]:
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

            # ── Load project context ────────────────────────────────────────
            config = await _load_project_config(db, job.project_id)

            # Read .env from project directory
            dotenv_vars = _read_dotenv_from_project(project_path)
            # Merge with configured env vars (config overrides dotenv)
            pw_config = (config.playwright_config or {}) if config else {}
            configured_env = pw_config.get("env_vars", {}) if isinstance(pw_config, dict) else {}
            all_env_vars = {**dotenv_vars, **configured_env}

            # Fetch OpenAPI spec
            openapi_spec = await _fetch_openapi_spec(config)
            openapi_endpoints = _parse_openapi_endpoints(openapi_spec) if openapi_spec else None

            # ── Phase 1: Discover entry points ───────────────────────────────
            job.status = ScanJobStatus.SCANNING
            job.progress = 10
            await db.commit()

            if structure:
                entry_points = _find_entry_points_from_structure(structure)
                job.files_found = structure.get("total_files", len(entry_points))
            else:
                logger.info("scan: scanning path=%r", project_path)
                entry_points = _find_entry_points_from_fs(project_path)
                logger.info("scan: found %d entry points", len(entry_points))
                job.files_found = len(entry_points)

            # Create synthetic entry points from OpenAPI when few files found
            if openapi_endpoints and len(entry_points) < 3:
                for ep in openapi_endpoints:
                    synthetic_path = f"api/{ep['path'].strip('/').replace('/', '_')}_{ep['method'].lower()}"
                    entry_points.append({
                        "path": synthetic_path,
                        "content_preview": f"{ep['method']} {ep['path']} — {ep.get('summary', '')}",
                        "extension": ".py",
                    })

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

            # Group entry points by module
            groups = _group_entry_points(entry_points)
            generated_count = 0
            total_groups = len(groups)

            for group_idx, (group_name, group_eps) in enumerate(groups.items()):
                # Limit to 10 groups to avoid extremely long scans
                if group_idx >= 10:
                    break

                # Filter relevant OpenAPI endpoints for this group
                relevant_endpoints = None
                if openapi_endpoints:
                    # Combine relevance from all files in the group
                    relevant_set: dict[str, dict[str, Any]] = {}
                    for ep in group_eps:
                        for rel in _filter_relevant_endpoints(openapi_endpoints, ep.get("path", "")):
                            key = f"{rel['method']}:{rel['path']}"
                            relevant_set[key] = rel
                    relevant_endpoints = list(relevant_set.values()) or openapi_endpoints[:5]

                # Determine test type from extensions in group
                extensions = {ep.get("extension", "") for ep in group_eps}
                test_type = "api" if ".py" in extensions else "e2e"

                prompt = _build_rich_prompt(
                    entry_points=group_eps,
                    group_name=group_name,
                    config=config,
                    env_vars=all_env_vars,
                    openapi_endpoints=relevant_endpoints,
                    test_type=test_type,
                )

                # Build project context for the AI agent
                project_context: dict[str, Any] = {}
                if config:
                    project_context["frontend_url"] = config.frontend_url
                    project_context["backend_url"] = config.backend_url
                    project_context["test_login_email"] = config.test_login_email
                    project_context["test_login_password"] = config.test_login_password
                if relevant_endpoints:
                    project_context["openapi_endpoints"] = relevant_endpoints

                if agent:
                    try:
                        result_ai = await asyncio.wait_for(
                            agent.generate(
                                prompt=prompt,
                                project_id=job.project_id,
                                test_type=test_type,
                                project_context=project_context,
                            ),
                            timeout=60.0,
                        )
                        tests = result_ai.get("tests", [])
                    except Exception as exc:
                        logger.debug("AI generation failed for group %s: %s", group_name, exc)
                        tests = [
                            _template_for(ep.get("path", "unknown"), test_type, config)
                            for ep in group_eps[:3]
                        ]
                else:
                    tests = [
                        _template_for(ep.get("path", "unknown"), test_type, config)
                        for ep in group_eps[:3]
                    ]

                # Store ALL generated tests (not just the first)
                for idx, code in enumerate(tests):
                    ep_path = group_eps[idx].get("path", group_name) if idx < len(group_eps) else group_name
                    gt = GeneratedTest(
                        scan_job_id=job_id,
                        project_id=job.project_id,
                        test_name=f"Test: {Path(ep_path).stem}",
                        test_code=code,
                        test_type=test_type,
                        entry_point=ep_path,
                        accepted=False,
                    )
                    db.add(gt)
                    generated_count += 1

                job.progress = 30 + int((group_idx + 1) / min(total_groups, 10) * 60)
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


def _template_for(path: str, test_type: str, config: ProjectConfig | None = None) -> str:
    """Return a starter test template for a given file, using real URLs when available."""
    name = Path(path).stem
    backend_url = (config.backend_url if config and config.backend_url else "http://localhost:8000")
    frontend_url = (config.frontend_url if config and config.frontend_url else "http://localhost:3000")

    if test_type == "api":
        return f"""import pytest
import httpx

# Auto-generated starter test for: {path}

@pytest.mark.asyncio
async def test_{name.lower().replace("-", "_")}():
    async with httpx.AsyncClient(base_url="{backend_url}") as client:
        response = await client.get("/")
        assert response.status_code == 200
"""
    return f"""import {{ test, expect }} from '@playwright/test'

// Auto-generated starter test for: {path}

test.describe('{name}', () => {{
  test('should render correctly', async ({{ page }}) => {{
    await page.goto('{frontend_url}/')
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


@router.delete("/generated-tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_generated_test(
    test_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a generated test suggestion."""
    result = await db.execute(select(GeneratedTest).where(GeneratedTest.id == test_id))
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated test not found")

    await db.delete(test)
    await db.commit()
