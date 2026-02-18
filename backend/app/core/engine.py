"""Test execution engine.

Runs tests for a project inside a subprocess, injects env vars from
playwright_config.env_vars, parses JSON output, and persists results.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import async_session_factory
from app.models.project import Project, ProjectConfig
from app.models.test_run import TestResult, TestRun, TestResultStatus, TestRunStatus

try:
    from app.ws import ws_manager
except Exception:
    ws_manager = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ── Shared virtualenv ─────────────────────────────────────────────────────────
# A single venv shared by all projects, stored inside the workspace volume.
# Each project's requirements are installed cumulatively; re-installed only
# when the project's requirements hash changes.
_SHARED_VENV = Path("workspace") / ".shared_venv"

# ── Process registry ──────────────────────────────────────────────────────────
# Maps run_id → subprocess.Process for cancellation and concurrency control
_running_processes: dict[str, asyncio.subprocess.Process] = {}
MAX_CONCURRENT_RUNS = 5


async def _broadcast_run(run_id: str, data: dict[str, Any]) -> None:
    """Broadcast run progress via WebSocket (no-op if WS unavailable)."""
    if ws_manager is not None:
        try:
            await ws_manager.broadcast("run", run_id, data)
        except Exception:
            pass


def cancel_run(run_id: str) -> bool:
    """Kill the subprocess for a given run_id. Returns True if process was found and killed."""
    proc = _running_processes.get(run_id)
    if proc and proc.returncode is None:
        proc.kill()
        logger.info("engine: killed subprocess for run %s", run_id)
        return True
    return False


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_effective_path(project_id: str, project_path: str) -> str:
    """Return the workspace path if a synced workspace exists, else translate the host path.

    The workspace takes priority: if Electron has uploaded project files to
    workspace/{project_id}/, use that directory directly.  This avoids the
    need for the backend container to have access to the host filesystem.
    """
    ws = Path("workspace") / project_id
    if ws.exists() and ws.is_dir():
        try:
            if any(ws.iterdir()):
                logger.info("engine: using synced workspace for project %s", project_id)
                return str(ws)
        except OSError:
            pass
    return _translate_path(project_path)


def _req_hash(workspace_path: Path) -> str:
    """MD5 of all requirements files in *workspace_path*.

    Used to detect when a project's dependencies have changed so the shared
    venv can be updated without reinstalling unchanged projects.
    """
    h = hashlib.md5()
    for fname in (
        "requirements.txt",
        "requirements-dev.txt",
        "requirements-test.txt",
        "pyproject.toml",
        "setup.cfg",
        "setup.py",
    ):
        f = workspace_path / fname
        if f.exists():
            try:
                h.update(fname.encode())
                h.update(f.read_bytes())
            except OSError:
                pass
    return h.hexdigest()


async def _ensure_shared_venv() -> Path | None:
    """Create the shared virtualenv if it does not exist yet.

    Returns the *bin/* directory of the venv (e.g. ``workspace/.shared_venv/bin``),
    or *None* if creation failed.
    """
    python_bin = _SHARED_VENV / "bin" / "python"
    if python_bin.exists():
        return _SHARED_VENV / "bin"

    _SHARED_VENV.mkdir(parents=True, exist_ok=True)
    logger.info("engine: creating shared venv at %s", _SHARED_VENV)
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "venv", str(_SHARED_VENV),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await asyncio.wait_for(proc.communicate(), timeout=60)
    if proc.returncode != 0:
        logger.warning("engine: failed to create shared venv: %s", err.decode()[:300])
        return None

    # Pre-install pytest-json-report so TestForge's --json-report flag always works.
    pip_bin = _SHARED_VENV / "bin" / "pip"
    pre_proc = await asyncio.create_subprocess_exec(
        str(pip_bin), "install", "pytest-json-report", "-q",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await asyncio.wait_for(pre_proc.communicate(), timeout=120)

    logger.info("engine: shared venv created at %s", _SHARED_VENV)
    return _SHARED_VENV / "bin"


async def _install_project_deps(
    project_id: str, workspace_path: Path, venv_bin: Path
) -> None:
    """Install (or skip if unchanged) project requirements into the shared venv.

    Tracks installed state with a per-project hash file so pip is only invoked
    when requirements actually change.
    """
    req_file = workspace_path / "requirements.txt"
    req_test = workspace_path / "requirements-test.txt"
    pyproject = workspace_path / "pyproject.toml"

    has_reqs = req_file.exists() or req_test.exists() or pyproject.exists()
    if not has_reqs:
        logger.debug("engine: no requirements found in %s — skipping dep install", workspace_path)
        return

    current_hash = _req_hash(workspace_path)
    hash_file = _SHARED_VENV / f".{project_id}.hash"

    if hash_file.exists():
        try:
            if hash_file.read_text().strip() == current_hash:
                logger.info("engine: shared venv already up to date for project %s", project_id)
                return
        except OSError:
            pass

    pip_bin = venv_bin / "pip"
    install_cmds: list[list[str]] = []

    if req_file.exists():
        install_cmds.append([str(pip_bin), "install", "-r", str(req_file), "-q"])
    if req_test.exists():
        install_cmds.append([str(pip_bin), "install", "-r", str(req_test), "-q"])
    if pyproject.exists() and not req_file.exists():
        install_cmds.append([str(pip_bin), "install", "-e", str(workspace_path), "-q"])

    # Ensure pytest-json-report is always present (may have been added post-venv-creation)
    install_cmds.append([str(pip_bin), "install", "pytest-json-report", "-q"])

    for cmd in install_cmds:
        logger.info("engine: %s", " ".join(cmd[:5]))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=600)  # 10 min
        except asyncio.TimeoutError:
            proc.kill()
            logger.warning("engine: pip install timed out for project %s", project_id)
            return
        if proc.returncode not in (0, None):
            logger.warning(
                "engine: pip install returned %s for project %s: %s",
                proc.returncode, project_id, err.decode()[:500],
            )
            # Continue — a partial install is better than nothing

    try:
        hash_file.write_text(current_hash)
    except OSError:
        pass

    logger.info("engine: deps installed for project %s in shared venv", project_id)


def _translate_path(project_path: str) -> str:
    """Translate a host-side path to the container mount path.

    Two modes (checked in order):
    1. Explicit prefix pair: if PROJECT_PATH_HOST_PREFIX is set and the project
       path starts with it, replace that prefix with PROJECT_PATH_CONTAINER_PREFIX.
    2. Auto-detect: if the path does not exist locally (typical inside Docker) and
       PROJECT_PATH_CONTAINER_PREFIX is set, try `container_prefix/basename(path)`.
       This covers the common case where the host projects folder is mounted flat,
       e.g. /host/Projetos/my-app → /workspace/my-app, without needing HOST_PREFIX.
    """
    container_prefix = settings.project_path_container_prefix.rstrip("/")
    if not container_prefix:
        return project_path

    host_prefix = settings.project_path_host_prefix.rstrip("/")

    # Mode 1 — explicit host prefix
    if host_prefix and project_path.startswith(host_prefix):
        return container_prefix + project_path[len(host_prefix):]

    # Mode 2 — auto-detect: path is a host path not visible in the container
    local = Path(project_path)
    if not local.exists():
        candidate = Path(container_prefix) / local.name
        if candidate.exists() and candidate.is_dir():
            logger.debug(
                "engine: auto-translated %s → %s via container prefix",
                project_path,
                candidate,
            )
            return str(candidate)

    return project_path


def _detect_runner(
    project_path: str,
    *,
    parallel_workers: int = 1,
    retry_count: int = 0,
    test_timeout: int = 30000,
    browser: str | None = None,
    venv_bin: Path | None = None,
) -> tuple[str, list[str], str]:
    """Return (layer, command_parts, cwd) for the project at *project_path*.

    cwd is the directory to run the command in (may be a subdir if Playwright is in e2e/ etc).
    Applies config-driven flags for parallelism, retries, timeout and browser.
    Handles network paths by resolving and checking readability.
    Translates host paths to container paths when PROJECT_PATH_HOST_PREFIX is set.
    """
    project_path = _translate_path(project_path)
    raw = Path(project_path)
    try:
        base = raw.resolve()
    except (OSError, RuntimeError):
        base = raw
    if not base.exists():
        hint = ""
        if project_path.startswith(("/Users/", "/Volumes/", "/home/")):
            hint = (
                " If the backend runs in Docker, set PROJECT_PATH_CONTAINER_PREFIX (e.g. /workspace) and "
                "mount the host folder that contains the projects: -v /Users/jluizgomes/Documents/Projetos:/workspace"
            )
        raise RuntimeError(
            f"Project path does not exist or is not accessible: {project_path}.{hint}"
        )
    if not base.is_dir():
        raise RuntimeError(
            f"Project path is not a directory: {project_path}"
        )
    try:
        next(base.iterdir(), None)
    except (OSError, PermissionError) as e:
        raise RuntimeError(
            f"Cannot read project directory (network path or permissions?): {project_path}. {e!s}"
        ) from e

    # Playwright (TypeScript / JavaScript) — root or common subdirs (e2e, tests, tests/e2e)
    playwright_configs = ("playwright.config.ts", "playwright.config.js", "playwright.config.mjs")
    search_dirs: list[Path] = [base]
    for sub in ("e2e", "tests", "tests/e2e", "playwright"):
        d = base / sub
        if d.is_dir():
            search_dirs.append(d)
    for root in search_dirs:
        for cfg in playwright_configs:
            if (root / cfg).exists():
                npx = shutil.which("npx") or "npx"
                cmd = [npx, "playwright", "test", "--reporter=json"]
                if parallel_workers > 1:
                    cmd += [f"--workers={parallel_workers}"]
                if retry_count > 0:
                    cmd += [f"--retries={retry_count}"]
                if test_timeout != 30000:
                    cmd += [f"--timeout={test_timeout}"]
                if browser and browser in ("chromium", "firefox", "webkit"):
                    cmd += [f"--project={browser}"]
                return "frontend", cmd, str(root)

    # pytest
    for cfg in ("pyproject.toml", "setup.cfg", "pytest.ini", "conftest.py"):
        if (base / cfg).exists():
            # Prefer the shared venv's pytest (has project deps + pytest-json-report).
            if venv_bin and (venv_bin / "pytest").exists():
                pytest_bin = str(venv_bin / "pytest")
            else:
                pytest_bin = shutil.which("pytest") or "pytest"
            cmd = [pytest_bin, "--json-report", "--json-report-file=-", "-q"]
            if parallel_workers > 1:
                cmd += ["-n", str(parallel_workers)]
            if retry_count > 0:
                cmd += [f"--count={retry_count}"]
            if test_timeout != 30000:
                cmd += [f"--timeout={test_timeout // 1000}"]
            return "backend", cmd, str(base)

    # package.json test script
    pkg = base / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text())
            scripts = data.get("scripts", {})
            if "test" in scripts:
                npm = shutil.which("npm") or "npm"
                return "frontend", [npm, "run", "test", "--", "--reporter=json"], str(base)
        except Exception:
            pass

    raise RuntimeError(
        f"Could not detect test runner at {project_path}. "
        "Supported: Playwright (playwright.config.* in root or e2e/tests), "
        "pytest (pyproject.toml/conftest.py), or npm test script. "
        "If this is a network path, ensure the backend can read the directory."
    )


def _parse_playwright_output(raw: str) -> list[dict[str, Any]]:
    """Parse Playwright --reporter=json stdout into a list of result dicts.

    Handles nested suites (describe blocks inside describe blocks) by
    walking the suite tree recursively.
    """
    results: list[dict[str, Any]] = []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Playwright may print progress lines before JSON; find the last { ... }
        start = raw.rfind("{")
        if start == -1:
            return results
        try:
            data = json.loads(raw[start:])
        except json.JSONDecodeError:
            return results

    def _walk_suite(
        suite: dict[str, Any],
        file_path: str,
        parent_title: str,
    ) -> None:
        title = suite.get("title", "")
        suite_title = f"{parent_title} > {title}" if parent_title and title else (title or parent_title)
        file_path = suite.get("file") or file_path

        # Collect specs at this level
        for spec in suite.get("specs", []):
            spec_title = spec.get("title", "")
            for test in spec.get("tests", []):
                for attempt in test.get("results", []):
                    status_raw = attempt.get("status", "passed")
                    status = {
                        "passed": TestResultStatus.PASSED,
                        "failed": TestResultStatus.FAILED,
                        "skipped": TestResultStatus.SKIPPED,
                        "timedOut": TestResultStatus.ERROR,
                    }.get(status_raw, TestResultStatus.ERROR)

                    error = attempt.get("error", {})
                    results.append(
                        {
                            "test_name": spec_title,
                            "test_file": file_path,
                            "test_suite": suite_title,
                            "test_layer": "frontend",
                            "status": status,
                            "duration_ms": attempt.get("duration", 0),
                            "error_message": error.get("message") if error else None,
                            "error_stack": error.get("stack") if error else None,
                        }
                    )

        # Recurse into child suites
        for child in suite.get("suites", []):
            _walk_suite(child, file_path, suite_title)

    for suite in data.get("suites", []):
        _walk_suite(suite, suite.get("file", ""), "")

    return results


def _parse_pytest_output(raw: str) -> list[dict[str, Any]]:
    """Parse pytest --json-report stdout into a list of result dicts."""
    results: list[dict[str, Any]] = []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return results

    for t in data.get("tests", []):
        nodeid: str = t.get("nodeid", "")
        # nodeid format: path/to/file.py::TestClass::test_name or path/to/file.py::test_name
        parts = nodeid.split("::")
        file_path = parts[0] if parts else ""
        test_name = parts[-1] if len(parts) >= 2 else nodeid
        suite = parts[1] if len(parts) >= 3 else None

        outcome = t.get("outcome", "passed")
        status = {
            "passed": TestResultStatus.PASSED,
            "failed": TestResultStatus.FAILED,
            "skipped": TestResultStatus.SKIPPED,
            "error": TestResultStatus.ERROR,
        }.get(outcome, TestResultStatus.ERROR)

        longrepr = t.get("longrepr") or ""
        results.append(
            {
                "test_name": test_name,
                "test_file": file_path,
                "test_suite": suite,
                "test_layer": "backend",
                "status": status,
                "duration_ms": int(t.get("duration", 0) * 1000),
                "error_message": str(longrepr)[:500] if longrepr else None,
                "error_stack": str(longrepr) if longrepr else None,
            }
        )
    return results


# ── Main engine ───────────────────────────────────────────────────────────────


async def run_tests_for_project(project_id: str, run_id: str) -> None:
    """Background task: execute tests, persist results, update run status."""
    async with async_session_factory() as db:
        await _execute(db, project_id, run_id)


async def _execute(db: AsyncSession, project_id: str, run_id: str) -> None:
    started = datetime.now(timezone.utc)

    # ── Load project + config ─────────────────────────────────────────────────
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        logger.error("engine: project %s not found", project_id)
        return

    cfg_result = await db.execute(
        select(ProjectConfig).where(ProjectConfig.project_id == project_id)
    )
    config: ProjectConfig | None = cfg_result.scalar_one_or_none()

    # env_vars stored in playwright_config.env_vars
    env_vars: dict[str, str] = {}
    if config and config.playwright_config:
        ev = config.playwright_config.get("env_vars")
        if isinstance(ev, dict):
            env_vars = {str(k): str(v) for k, v in ev.items()}

    project_path = _get_effective_path(str(project.id), project.path)

    # ── Shared venv + workspace env vars (only when workspace is synced) ──────
    venv_bin: Path | None = None
    ws_path = Path("workspace") / str(project.id)
    if project_path == str(ws_path):
        # 1. Auto-load env vars from .env / .env.local in the workspace.
        #    These are merged UNDER the manually configured env_vars so that
        #    explicit project settings always take precedence.
        for dotenv_name in (".env", ".env.local", ".env.test"):
            dotenv_file = ws_path / dotenv_name
            if dotenv_file.exists():
                try:
                    for line in dotenv_file.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, _, val = line.partition("=")
                        key = key.strip()
                        val = val.strip().strip("'\"")
                        if key and key not in env_vars:  # don't override explicit config
                            env_vars[key] = val
                    logger.info("engine: loaded env from %s", dotenv_file)
                except OSError:
                    pass

        # 2. Install project dependencies into the shared venv.
        try:
            venv_bin = await _ensure_shared_venv()
            if venv_bin:
                await _install_project_deps(str(project.id), ws_path, venv_bin)
        except Exception as exc:
            logger.warning("engine: venv setup failed (will use system python): %s", exc)

    # ── Mark run as RUNNING ───────────────────────────────────────────────────
    run_result = await db.execute(select(TestRun).where(TestRun.id == run_id))
    test_run: TestRun | None = run_result.scalar_one_or_none()
    if not test_run:
        logger.error("engine: run %s not found", run_id)
        return

    test_run.status = TestRunStatus.RUNNING
    test_run.started_at = started
    await db.commit()
    await _broadcast_run(run_id, {"status": "running", "progress": 0})

    # ── Detect runner ─────────────────────────────────────────────────────────
    try:
        layer, cmd, run_cwd = _detect_runner(
            project_path,
            parallel_workers=config.parallel_workers if config else 1,
            retry_count=config.retry_count if config else 0,
            test_timeout=config.test_timeout if config else 30000,
            browser=config.browser if config else None,
            venv_bin=venv_bin,
        )
    except RuntimeError as exc:
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = str(exc)
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {"status": "failed", "error_message": str(exc)})
        logger.warning("engine: %s", exc)
        return

    # ── Build subprocess env (inherit + inject project vars) ──────────────────
    proc_env = {**os.environ, **env_vars}

    logger.info(
        "engine: running %s in cwd=%s (env_vars=%d keys)",
        " ".join(cmd),
        run_cwd,
        len(env_vars),
    )

    # ── Concurrency guard ─────────────────────────────────────────────────────
    if len(_running_processes) >= MAX_CONCURRENT_RUNS:
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = f"Too many concurrent runs ({MAX_CONCURRENT_RUNS} max)"
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {
            "status": "failed", "error_message": test_run.error_message,
        })
        return

    # ── Execute ───────────────────────────────────────────────────────────────
    stdout_buf: list[bytes] = []
    stderr_buf: list[bytes] = []
    returncode = 1
    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=run_cwd,
            env=proc_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _running_processes[run_id] = proc
        stdout_raw, stderr_raw = await asyncio.wait_for(
            proc.communicate(), timeout=300  # 5-minute hard cap
        )
        stdout_buf = [stdout_raw]
        stderr_buf = [stderr_raw]
        returncode = proc.returncode or 0
    except asyncio.TimeoutError:
        if proc:
            proc.kill()
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = "Test run timed out after 5 minutes"
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {
            "status": "failed", "error_message": test_run.error_message,
        })
        return
    except Exception as exc:
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = f"Failed to start test process: {exc}"
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {
            "status": "failed", "error_message": test_run.error_message,
        })
        logger.exception("engine: subprocess error")
        return
    finally:
        _running_processes.pop(run_id, None)

    stdout_text = b"".join(stdout_buf).decode("utf-8", errors="replace")
    stderr_text = b"".join(stderr_buf).decode("utf-8", errors="replace")

    logger.debug("engine stdout: %s", stdout_text[:2000])
    if stderr_text:
        logger.debug("engine stderr: %s", stderr_text[:1000])

    # ── Parse results ─────────────────────────────────────────────────────────
    if layer == "frontend":
        parsed = _parse_playwright_output(stdout_text)
    else:
        parsed = _parse_pytest_output(stdout_text)

    # Fallback: if parsing failed, create a single result from return code
    if not parsed:
        status = TestResultStatus.PASSED if returncode == 0 else TestResultStatus.FAILED
        parsed = [
            {
                "test_name": "Test Run",
                "test_file": None,
                "test_suite": None,
                "test_layer": layer,
                "status": status,
                "duration_ms": None,
                "error_message": stderr_text[:500] if returncode != 0 else None,
                "error_stack": stderr_text if returncode != 0 else None,
            }
        ]

    # ── Persist TestResult rows ───────────────────────────────────────────────
    for r in parsed:
        db.add(
            TestResult(
                id=str(uuid4()),
                test_run_id=run_id,
                test_name=r["test_name"],
                test_file=r.get("test_file"),
                test_suite=r.get("test_suite"),
                test_layer=r.get("test_layer", layer),
                status=r["status"],
                duration_ms=r.get("duration_ms"),
                error_message=r.get("error_message"),
                error_stack=r.get("error_stack"),
            )
        )

    # ── Re-check run status (may have been cancelled while subprocess ran) ───
    await db.refresh(test_run)
    if test_run.status == TestRunStatus.CANCELLED:
        logger.info("engine: run %s was cancelled while executing", run_id)
        await _broadcast_run(run_id, {"status": "cancelled", "progress": 100})
        return

    # ── Update run summary ────────────────────────────────────────────────────
    completed = datetime.now(timezone.utc)
    passed = sum(1 for r in parsed if r["status"] == TestResultStatus.PASSED)
    failed = sum(1 for r in parsed if r["status"] == TestResultStatus.FAILED)
    skipped = sum(1 for r in parsed if r["status"] == TestResultStatus.SKIPPED)
    total = len(parsed)

    test_run.total_tests = total
    test_run.passed_tests = passed
    test_run.failed_tests = failed
    test_run.skipped_tests = skipped
    test_run.completed_at = completed
    test_run.duration_ms = int((completed - started).total_seconds() * 1000)
    test_run.status = TestRunStatus.PASSED if failed == 0 else TestRunStatus.FAILED

    await db.commit()
    await _broadcast_run(run_id, {
        "status": test_run.status.value if hasattr(test_run.status, "value") else test_run.status,
        "progress": 100,
        "total_tests": total,
        "passed_tests": passed,
        "failed_tests": failed,
        "skipped_tests": skipped,
    })
    logger.info(
        "engine: run %s done — %d/%d passed in %dms",
        run_id,
        passed,
        total,
        test_run.duration_ms,
    )
