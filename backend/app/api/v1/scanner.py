"""Project scanner — discovers entry points and generates AI test suggestions."""

import asyncio
import hashlib
import io
import logging
import re
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security.encryption import decrypt_value
from app.core.security.masking import mask_credential, mask_url
from app.db.session import async_session_factory, get_db
from app.models.project import Project, ProjectConfig
from app.models.scanner import GeneratedTest, ScanJob, ScanJobStatus
try:
    from app.ws import ws_manager
except Exception:
    ws_manager = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

router = APIRouter()

# Extensions considered "interesting" for test generation
_ENTRY_POINT_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx",           # JS/TS ecosystem
    ".py", ".go", ".java", ".rb", ".php",   # Backend languages
    ".vue", ".svelte",                       # Framework components
}
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".testforge_venv",
    ".pytest_cache", "htmlcov", ".cache", "__mocks__",
    "coverage", ".nyc_output", "storybook-static",
    # Migration/seed directories — these define schema, not business logic.
    # Testing migration files themselves is not meaningful; database tests
    # should target models, repositories, and endpoints instead.
    "migrations", "alembic", "versions", "seeds", "seed", "fixtures",
}

# File-name patterns that indicate infrastructure/schema files rather than
# testable business logic. These are skipped even when not inside a _SKIP_DIR.
_SKIP_FILE_RE = re.compile(
    r"(^|\b)(env\.py|alembic\.ini|manage\.py|wsgi\.py|asgi\.py"
    r"|settings\.py|conftest\.py|__init__\.py)$",
    re.IGNORECASE,
)

# Patterns that signal a file has testable behaviour
_ENTRY_PATTERNS = [
    # HTTP routes — Express, FastAPI, Flask, Django, Koa
    re.compile(r"(router|Route|app|blueprint)\.(get|post|put|delete|patch|head)\s*\("),
    re.compile(r"@(router|app|bp)\.(get|post|put|delete|patch)\s*\("),
    # Class-based views & serializers
    re.compile(r"class\s+\w+(View|ViewSet|APIView|Serializer|Schema|Controller|Resource)\s*[\(:]"),
    # Service / use-case / repository layer
    re.compile(r"class\s+\w+(Service|UseCase|Repository|Manager|Handler|Provider|Facade)\s*[\(:]"),
    # React / Vue / Svelte components
    re.compile(r"(useState|useEffect|useContext|useCallback|useMemo|useReducer)\s*\("),
    re.compile(r"export\s+(default\s+)?(function|const|class)\s+[A-Z]\w+"),
    re.compile(r"<template>|defineComponent|setup\(\)"),
    # Next.js / Nuxt pages
    re.compile(r"export\s+default\s+function\s+\w+Page"),
    re.compile(r"getServerSideProps|getStaticProps|definePageComponent"),
    # Celery / background tasks
    re.compile(r"@(shared_task|app\.task|celery\.task)"),
    # Pytest / Jest / Mocha — existing test files are useful as AI reference
    re.compile(r"(def test_|it\(|describe\(|test\(|@pytest)"),
    # Generic: any named function that looks like a public API
    re.compile(r"^(async\s+)?def\s+[a-z]\w+\s*\(", re.MULTILINE),
    re.compile(r"^(export\s+)?(async\s+)?function\s+[a-z]\w+\s*\(", re.MULTILINE),
]

# Path-segment keywords for database classification
_DATABASE_PATH_RE = re.compile(
    r"(models?|migrations?|schema|repositor|dao|entit|seeds?|fixtures?|orm|"
    r"database|prisma|typeorm|sequelize|knex|alembic|eloquent|activerecord)",
    re.IGNORECASE,
)
# Content patterns for service/integration layer
_SERVICE_PATH_RE = re.compile(
    r"(service[s]?|use.?case[s]?|handler[s]?|provider[s]?|manager[s]?|"
    r"helper[s]?|util[s]?|lib[s]?|client[s]?|adapter[s]?)",
    re.IGNORECASE,
)
# Content patterns for E2E / page layer
_PAGE_PATH_RE = re.compile(
    r"(pages?|views?|screen[s]?|layout[s]?|template[s]?|component[s]?)",
    re.IGNORECASE,
)


def _classify_entry_point(ep: dict[str, Any]) -> str:
    """Classify an entry point as api/e2e/unit/integration/database/component.

    Uses both the file path and a snippet of the source content for accuracy.
    """
    path = ep.get("path", "").replace("\\", "/").lower()
    extension = ep.get("extension", Path(path).suffix).lower()
    content = ep.get("content_preview", "")

    # ── JS / TS / Vue / Svelte ────────────────────────────────────────────────
    if extension in {".tsx", ".jsx", ".vue", ".svelte"}:
        if _PAGE_PATH_RE.search(path):
            return "e2e"        # page/screen → Playwright/Cypress
        return "component"      # component → React Testing Library / Vitest

    if extension in {".ts", ".js"}:
        if re.search(r"(\.test\.|\.spec\.|cypress|playwright|puppeteer)", path):
            return "e2e"
        if _PAGE_PATH_RE.search(path):
            return "e2e"
        if re.search(r"(api[s]?/|routes?/|controller[s]?/|endpoint[s]?/)", path):
            return "api"
        return "component"      # generic TS/JS → component test

    # ── Python / Go / Java / Ruby / PHP ──────────────────────────────────────
    if extension in {".py", ".go", ".java", ".rb", ".php"}:
        if re.search(r"(test_|_test\.|\.test\.|spec_|_spec\.)", path):
            return "unit"       # existing test file → reference for new tests
        if _DATABASE_PATH_RE.search(path):
            return "database"
        if re.search(r"(api[s]?/|routes?/|views?/|endpoint[s]?/|controller[s]?/)", path):
            return "api"
        if _SERVICE_PATH_RE.search(path):
            return "integration"
        # Content fallback: if it imports httpx/requests/aiohttp → integration
        if re.search(r"(httpx|requests|aiohttp|urllib|fetch)\.", content):
            return "integration"
        return "api"            # default for backend files

    return "api"


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
    entry_points_by_type: dict[str, int] = {}
    tests_by_type: dict[str, int] = {}
    error_message: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _map_id(cls, data: Any) -> Any:
        """Map ScanJob.id → job_id for the response schema."""
        if hasattr(data, "id"):
            ep = getattr(data, "entry_points_by_type", None)
            tb = getattr(data, "_tests_by_type", None)
            return {
                "job_id": str(data.id),
                "status": getattr(data, "status", ScanJobStatus.PENDING),
                "progress": int(getattr(data, "progress", 0)),
                "files_found": int(getattr(data, "files_found", 0)),
                "entry_points_found": int(getattr(data, "entry_points_found", 0)),
                "tests_generated": int(getattr(data, "tests_generated", 0)),
                "entry_points_by_type": ep if isinstance(ep, dict) else {},
                "tests_by_type": tb if isinstance(tb, dict) else {},
                "error_message": getattr(data, "error_message", None),
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


_LAYER_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"/(api[s]?|endpoints?|routes?)/",        re.IGNORECASE), "api"),
    (re.compile(r"/(controller[s]?)/",                    re.IGNORECASE), "controllers"),
    (re.compile(r"/(service[s]?|use.?case[s]?)/",         re.IGNORECASE), "services"),
    (re.compile(r"/(model[s]?|entit|orm|schema)/",        re.IGNORECASE), "models"),
    (re.compile(r"/(repositor|dao)/",                     re.IGNORECASE), "repositories"),
    (re.compile(r"/(migration[s]?|seed[s]?|fixture[s]?)/",re.IGNORECASE), "migrations"),
    (re.compile(r"/(component[s]?)/",                     re.IGNORECASE), "components"),
    (re.compile(r"/(page[s]?|screen[s]?|view[s]?)/",      re.IGNORECASE), "pages"),
    (re.compile(r"/(layout[s]?|template[s]?)/",           re.IGNORECASE), "layouts"),
    (re.compile(r"/(hook[s]?)/",                          re.IGNORECASE), "hooks"),
    (re.compile(r"/(util[s]?|helper[s]?|lib[s]?)/",       re.IGNORECASE), "utils"),
    (re.compile(r"/(task[s]?|worker[s]?|job[s]?|queue[s]?)/", re.IGNORECASE), "tasks"),
    (re.compile(r"/(auth|security|permission[s]?)/",       re.IGNORECASE), "auth"),
    (re.compile(r"/(config|setting[s]?|conf)/",            re.IGNORECASE), "config"),
    (re.compile(r"/(test[s]?|spec[s]?)/",                  re.IGNORECASE), "tests"),
    (re.compile(r"/(middleware[s]?)/",                     re.IGNORECASE), "middleware"),
    (re.compile(r"/(websocket[s]?|socket[s]?|ws)/",        re.IGNORECASE), "websockets"),
]
_MAX_EPS_PER_GROUP = 12   # cap files sent to AI per group prompt


def _group_entry_points(
    entry_points: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Group entry points by architectural layer for diverse, focused test generation.

    Uses path-segment patterns to map files to layers (api, services, models, …).
    Falls back to the first meaningful directory when no layer matches.
    Large layers are split into numbered sub-groups so each AI call stays focused.
    """
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for ep in entry_points:
        fwd = "/" + ep.get("path", "").replace("\\", "/")
        assigned = False
        for pattern, layer in _LAYER_PATTERNS:
            if pattern.search(fwd):
                groups[layer].append(ep)
                assigned = True
                break
        if not assigned:
            parts = Path(ep.get("path", "")).parts
            if len(parts) >= 2:
                key = parts[0] if parts[0] not in ("src", "app", "lib", "backend", "frontend") \
                      else "/".join(parts[:2])
            else:
                key = "root"
            groups[key].append(ep)

    # Split oversized groups so each AI prompt stays manageable
    final: dict[str, list[dict[str, Any]]] = {}
    for layer, eps in groups.items():
        if len(eps) <= _MAX_EPS_PER_GROUP:
            final[layer] = eps
        else:
            for chunk_idx, start in enumerate(range(0, len(eps), _MAX_EPS_PER_GROUP)):
                final[f"{layer}/{chunk_idx + 1}"] = eps[start:start + _MAX_EPS_PER_GROUP]

    return final


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
            url_lines.append(f"  Database URL: {mask_url(config.database_url)}")
        if url_lines:
            sections.append("Project URLs (use these in tests):\n" + "\n".join(url_lines))

    # Test credentials (masked — never send real passwords to LLM)
    if config and (config.test_login_email or config.test_login_password):
        cred_lines = []
        if config.test_login_email:
            cred_lines.append(f"  Email: {config.test_login_email}")
        if config.test_login_password:
            cred_lines.append(f"  Password: {mask_credential(config.test_login_password)}")
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


def _find_entry_points_from_fs(project_path: str, max_files: int = 3000) -> list[dict[str, Any]]:
    """Walk the project filesystem and collect testable entry-point files.

    Changes vs. old implementation:
    - max_files raised to 3000 (was 500) so large projects are fully covered.
    - Content preview raised to 1500 chars (was 800) for better AI context.
    - Qualification broadened: any file with a named function/class/component
      qualifies, not just files with route patterns.
    - Files are sorted by path so all directories get a proportional share
      before the limit kicks in.
    """
    root = Path(project_path)
    if not root.exists():
        return []

    # Collect all candidate files first, then sort for deterministic coverage
    candidates: list[Path] = []
    for fp in root.rglob("*"):
        if any(skip in fp.parts for skip in _SKIP_DIRS):
            continue
        if not fp.is_file() or fp.suffix not in _ENTRY_POINT_EXTENSIONS:
            continue
        if _SKIP_FILE_RE.search(fp.name):
            continue
        candidates.append(fp)

    # Sort so files are visited in a predictable, path-ordered way
    candidates.sort(key=lambda p: str(p))

    entry_points: list[dict[str, Any]] = []
    scanned = 0

    for file_path in candidates:
        if scanned >= max_files:
            break
        scanned += 1
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            # Broad qualification: any pattern match OR generic class/function presence
            is_entry = (
                any(p.search(content) for p in _ENTRY_PATTERNS)
                or "export default" in content
                or "class " in content
            )
            if not is_entry:
                continue

            preview = content[:1500]
            entry_points.append({
                "path": str(file_path.relative_to(root)),
                "content_preview": preview,
                "extension": file_path.suffix,
                "content_hash": hashlib.md5(content.encode()).hexdigest(),
            })
        except Exception:
            pass

    logger.info(
        "scan: scanned %d files, found %d entry points (max_files=%d)",
        scanned, len(entry_points), max_files,
    )
    return entry_points


def _find_entry_points_from_structure(structure: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract entry points from a pre-discovered structure (sent by Electron)."""
    entry_points = []
    for ep in structure.get("entry_points", []):
        if isinstance(ep, str):
            entry_points.append({"path": ep, "content_preview": "", "extension": Path(ep).suffix})
        elif isinstance(ep, dict):
            # Compute hash if content_preview is present and hash is missing
            if ep.get("content_preview") and not ep.get("content_hash"):
                ep["content_hash"] = hashlib.md5(ep["content_preview"].encode()).hexdigest()
            entry_points.append(ep)
    return entry_points


async def _broadcast_scan_progress(
    job: ScanJob,
    tests_by_type: dict[str, int] | None = None,
) -> None:
    """Push scan progress to connected WebSocket clients."""
    if ws_manager is None:
        return
    try:
        await ws_manager.broadcast("scan", str(job.id), {
            "status": job.status.value if isinstance(job.status, ScanJobStatus) else job.status,
            "progress": job.progress,
            "files_found": job.files_found,
            "entry_points_found": job.entry_points_found,
            "tests_generated": job.tests_generated,
            "entry_points_by_type": job.entry_points_by_type or {},
            "tests_by_type": tests_by_type or {},
            "error_message": job.error_message,
        })
    except Exception:
        pass


async def _run_scan(job_id: str, project_path: str, structure: dict[str, Any] | None) -> None:
    """Background task: scan project and generate test suggestions via AI."""
    from app.core.engine import _get_effective_path

    async with async_session_factory() as db:
        try:
            # Load job
            result = await db.execute(select(ScanJob).where(ScanJob.id == job_id))
            job = result.scalar_one_or_none()
            if not job:
                return

            # ── Load project context ────────────────────────────────────────
            config = await _load_project_config(db, job.project_id)

            # Decrypt sensitive fields in-memory for use during scan
            if config:
                if config.test_login_password:
                    config.test_login_password = decrypt_value(config.test_login_password)
                if config.database_url:
                    config.database_url = decrypt_value(config.database_url)

            # Resolve effective path: use synced workspace if available
            effective_path = _get_effective_path(job.project_id, project_path)
            ws_path = str(Path("workspace") / job.project_id)
            using_workspace = (effective_path == ws_path)

            # Read .env from effective path (workspace or host)
            dotenv_vars = _read_dotenv_from_project(effective_path)
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
            await _broadcast_scan_progress(job)

            if using_workspace:
                # Workspace is synced — scan real files inside the container.
                # This gives AI full file content, not just structure metadata.
                logger.info("scan: scanning synced workspace at %r", effective_path)
                entry_points = _find_entry_points_from_fs(effective_path)
                logger.info("scan: found %d entry points in workspace", len(entry_points))
                job.files_found = len(entry_points)
            elif structure:
                # No workspace — fall back to pre-discovered structure from Electron
                entry_points = _find_entry_points_from_structure(structure)
                job.files_found = structure.get("total_files", len(entry_points))
            else:
                logger.info("scan: scanning path=%r (effective=%r)", project_path, effective_path)
                entry_points = _find_entry_points_from_fs(effective_path)
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

            # Classify entry points by type (api / e2e / unit / integration / database / component)
            ep_type_counts: dict[str, int] = defaultdict(int)
            for ep in entry_points:
                ep["resource_type"] = _classify_entry_point(ep)
                ep_type_counts[ep["resource_type"]] += 1

            job.entry_points_found = len(entry_points)
            job.entry_points_by_type = ep_type_counts
            job.progress = 30
            await db.commit()
            await _broadcast_scan_progress(job)

            # ── Incremental: skip unchanged entry points ─────────────────────
            existing_result = await db.execute(
                select(GeneratedTest.entry_point, GeneratedTest.content_hash)
                .where(
                    GeneratedTest.project_id == job.project_id,
                    GeneratedTest.content_hash.isnot(None),
                )
            )
            existing_hashes = {
                row.entry_point: row.content_hash
                for row in existing_result.all()
            }
            if existing_hashes:
                before = len(entry_points)
                entry_points = [
                    ep for ep in entry_points
                    if ep.get("content_hash") != existing_hashes.get(ep.get("path"))
                ]
                skipped = before - len(entry_points)
                if skipped:
                    logger.info(
                        "scan: incremental — skipped %d unchanged, %d new/modified",
                        skipped,
                        len(entry_points),
                    )

            # ── Phase 2: Generate tests via AI ───────────────────────────────
            job.status = ScanJobStatus.GENERATING
            await db.commit()
            await _broadcast_scan_progress(job)

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

            # Group entry points by architectural layer
            groups = _group_entry_points(entry_points)
            generated_count = 0
            tests_by_type: dict[str, int] = {"backend": 0, "frontend": 0, "database": 0}
            total_groups = len(groups)
            _MAX_GROUPS = 30  # was 10

            for group_idx, (group_name, group_eps) in enumerate(groups.items()):
                if group_idx >= _MAX_GROUPS:
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

                # Determine test_type from the dominant resource_type in this group.
                # Priority: database > e2e > component > integration > api > unit
                resource_types = [ep.get("resource_type", "api") for ep in group_eps]
                type_priority = ["database", "e2e", "component", "integration", "api", "unit"]
                type_counts: dict[str, int] = {}
                for rt in resource_types:
                    type_counts[rt] = type_counts.get(rt, 0) + 1
                test_type = max(type_counts, key=lambda t: (type_priority.index(t) if t in type_priority else 99, -type_counts[t]))
                # Remap internal types to AI-friendly labels
                test_type = {
                    "component": "e2e",
                    "unit": "api",
                    "integration": "api",
                }.get(test_type, test_type)

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
                    project_context["test_login_password"] = mask_credential(config.test_login_password)
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
                    ep_data = group_eps[idx] if idx < len(group_eps) else {}
                    ep_path = ep_data.get("path", group_name) if ep_data else group_name
                    # Use the individual entry point's resource_type when available
                    ep_test_type = test_type
                    if ep_data:
                        rt = ep_data.get("resource_type", "")
                        ep_test_type = {
                            "database": "database",
                            "e2e": "e2e",
                            "component": "e2e",
                            "integration": "api",
                            "unit": "api",
                            "api": "api",
                        }.get(rt, test_type)
                    gt = GeneratedTest(
                        scan_job_id=job_id,
                        project_id=job.project_id,
                        test_name=f"Test: {Path(ep_path).stem}",
                        test_code=code,
                        test_type=ep_test_type,
                        entry_point=ep_path,
                        content_hash=ep_data.get("content_hash"),
                        accepted=False,
                    )
                    db.add(gt)
                    generated_count += 1
                    # Map test_type to category for counting
                    if ep_test_type == "database":
                        tests_by_type["database"] += 1
                    elif ep_test_type == "e2e":
                        tests_by_type["frontend"] += 1
                    else:
                        tests_by_type["backend"] += 1

                job.progress = 30 + int((group_idx + 1) / min(total_groups, 10) * 60)
                job.tests_generated = generated_count
                await db.commit()
                await _broadcast_scan_progress(job, tests_by_type=tests_by_type)

            job.status = ScanJobStatus.COMPLETED
            job.progress = 100
            job.tests_generated = generated_count
            await db.commit()
            await _broadcast_scan_progress(job, tests_by_type=tests_by_type)

        except Exception as exc:
            logger.exception("Scan job %s failed: %s", job_id, exc)
            async with async_session_factory() as error_db:
                err_result = await error_db.execute(select(ScanJob).where(ScanJob.id == job_id))
                err_job = err_result.scalar_one_or_none()
                if err_job:
                    err_job.status = ScanJobStatus.FAILED
                    err_job.error_message = str(exc)
                    await error_db.commit()
                    await _broadcast_scan_progress(err_job)


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
) -> ScanStatusResponse:
    """Start a background scan of the project to discover entry points and generate tests."""
    try:
        proj_result = await db.execute(
            select(Project).where(Project.id == request.project_id, Project.is_active == True)
        )
        project = proj_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

        active_result = await db.execute(
            select(ScanJob.id).where(
                ScanJob.project_id == request.project_id,
                ScanJob.status.in_([
                    ScanJobStatus.PENDING,
                    ScanJobStatus.SCANNING,
                    ScanJobStatus.GENERATING,
                ]),
            ).limit(1)
        )
        if active_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A scan is already in progress for this project",
            )

        structure = request.pre_discovered_structure if isinstance(request.pre_discovered_structure, dict) else None
        job = ScanJob(
            project_id=request.project_id,
            status=ScanJobStatus.PENDING,
            progress=0,
            discovered_structure=structure,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)

        asyncio.create_task(
            _run_scan(
                job_id=job.id,
                project_path=project.path,
                structure=structure,
            )
        )

        # Build response from scalars to avoid ORM lazy load / enum issues
        status_val = getattr(job, "status", None)
        if isinstance(status_val, str):
            try:
                status_val = ScanJobStatus(status_val)
            except ValueError:
                status_val = ScanJobStatus.PENDING
        elif status_val is None:
            status_val = ScanJobStatus.PENDING
        return ScanStatusResponse(
            job_id=str(job.id),
            status=status_val,
            progress=int(getattr(job, "progress", 0)),
            files_found=int(getattr(job, "files_found", 0)),
            entry_points_found=int(getattr(job, "entry_points_found", 0)),
            tests_generated=int(getattr(job, "tests_generated", 0)),
            entry_points_by_type=ep if isinstance(ep := getattr(job, "entry_points_by_type", None), dict) else {},
            tests_by_type={},
            error_message=getattr(job, "error_message", None),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("start_scan failed for project %s: %s", request.project_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start scan",
        ) from e


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

    # Compute tests_by_type from generated tests
    from sqlalchemy import func as sa_func

    type_counts_result = await db.execute(
        select(GeneratedTest.test_type, sa_func.count())
        .where(GeneratedTest.scan_job_id == job_id)
        .group_by(GeneratedTest.test_type)
    )
    type_map = {"api": "backend", "e2e": "frontend", "database": "database"}
    tbt: dict[str, int] = {"backend": 0, "frontend": 0, "database": 0}
    for test_type, cnt in type_counts_result.all():
        tbt[type_map.get(test_type, "backend")] += cnt
    job._tests_by_type = tbt  # type: ignore[attr-defined]

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


class ScanStatsResponse(BaseModel):
    """Resource coverage stats from the latest scan."""

    entry_points_by_type: dict[str, int] = {}
    tests_by_type: dict[str, int] = {}
    total_resources: int = 0
    total_tests: int = 0


@router.get("/stats/{project_id}", response_model=ScanStatsResponse)
async def get_scan_stats(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ScanStatsResponse:
    """Get resource coverage stats from the latest completed scan."""
    try:
        job_result = await db.execute(
            select(ScanJob)
            .where(ScanJob.project_id == project_id, ScanJob.status == ScanJobStatus.COMPLETED)
            .order_by(ScanJob.created_at.desc())
            .limit(1)
        )
        job = job_result.scalar_one_or_none()
    except Exception as e:
        logger.warning("get_scan_stats job lookup failed for project %s: %s", project_id, e)
        return ScanStatsResponse()

    if not job:
        return ScanStatsResponse()

    ep_by_type = job.entry_points_by_type if isinstance(job.entry_points_by_type, dict) else {}

    from sqlalchemy import func as sa_func

    type_map = {"api": "backend", "e2e": "frontend", "database": "database"}
    tbt: dict[str, int] = {"backend": 0, "frontend": 0, "database": 0}
    try:
        type_counts_result = await db.execute(
            select(GeneratedTest.test_type, sa_func.count())
            .where(GeneratedTest.project_id == project_id)
            .group_by(GeneratedTest.test_type)
        )
        for row in type_counts_result.all():
            test_type = row[0] if len(row) >= 1 else "backend"
            cnt = int(row[1]) if len(row) >= 2 else 0
            key = type_map.get(test_type, "backend")
            tbt[key] = tbt.get(key, 0) + cnt
    except Exception as e:
        logger.warning("get_scan_stats type_counts failed for project %s: %s", project_id, e)

    return ScanStatsResponse(
        entry_points_by_type=ep_by_type,
        tests_by_type=tbt,
        total_resources=sum(v for v in ep_by_type.values() if isinstance(v, (int, float))),
        total_tests=sum(tbt.values()),
    )


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


@router.get("/export/{project_id}")
async def export_accepted_tests(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Export all accepted test suggestions as a ZIP file."""
    result = await db.execute(
        select(GeneratedTest)
        .where(GeneratedTest.project_id == project_id, GeneratedTest.accepted == True)
        .order_by(GeneratedTest.created_at)
    )
    tests = list(result.scalars().all())

    if not tests:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No accepted tests found for this project",
        )

    buf = io.BytesIO()
    used_names: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in tests:
            # Determine folder and extension based on test_type
            if t.test_type == "database":
                folder = "database"
                ext = ".test.py"
            elif t.test_type == "api":
                folder = "api"
                ext = ".test.py"
            else:
                folder = "e2e"
                ext = ".spec.ts"

            stem = Path(t.test_name.removeprefix("Test: ")).stem or "test"
            # Sanitize filename
            stem = re.sub(r"[^\w\-]", "_", stem).strip("_") or "test"
            name = f"{folder}/{stem}{ext}"

            # Dedup with numeric suffix
            if name in used_names:
                counter = 2
                while f"{folder}/{stem}_{counter}{ext}" in used_names:
                    counter += 1
                name = f"{folder}/{stem}_{counter}{ext}"
            used_names.add(name)

            zf.writestr(name, t.test_code)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=tests-{project_id[:8]}.zip"},
    )
