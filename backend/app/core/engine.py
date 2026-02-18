"""Test execution engine.

Runs tests for a project inside a subprocess, injects env vars from
playwright_config.env_vars, parses JSON output, and persists results.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
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


def _detect_runner(project_path: str) -> tuple[str, list[str]]:
    """Return (layer, command_parts) for the project at *project_path*."""
    base = Path(project_path)

    # Playwright (TypeScript / JavaScript)
    for cfg in ("playwright.config.ts", "playwright.config.js", "playwright.config.mjs"):
        if (base / cfg).exists():
            npx = shutil.which("npx") or "npx"
            return "frontend", [npx, "playwright", "test", "--reporter=json"]

    # pytest
    for cfg in ("pyproject.toml", "setup.cfg", "pytest.ini", "conftest.py"):
        if (base / cfg).exists():
            pytest_bin = shutil.which("pytest") or "pytest"
            return "backend", [pytest_bin, "--json-report", "--json-report-file=-", "-q"]

    # package.json test script
    pkg = base / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text())
            scripts = data.get("scripts", {})
            if "test" in scripts:
                npm = shutil.which("npm") or "npm"
                return "frontend", [npm, "run", "test", "--", "--reporter=json"]
        except Exception:
            pass

    raise RuntimeError(
        f"Could not detect test runner at {project_path}. "
        "Supported: Playwright (playwright.config.*), pytest (pyproject.toml/conftest.py), "
        "or npm test script."
    )


def _parse_playwright_output(raw: str) -> list[dict[str, Any]]:
    """Parse Playwright --reporter=json stdout into a list of result dicts."""
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

    for suite in data.get("suites", []):
        file_path = suite.get("file", "")
        suite_title = suite.get("title", "")
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

    project_path = project.path
    # When running in Docker, rewrite host path to container path if mapping is set
    hp, cp = settings.project_path_host_prefix.strip(), settings.project_path_container_prefix.strip()
    if hp and cp and project_path.startswith(hp):
        project_path = cp.rstrip("/") + project_path[len(hp) :].replace("\\", "/")
        logger.info("engine: path mapped to container path %s", project_path)

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
        layer, cmd = _detect_runner(project_path)
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
        "engine: running %s in %s (env_vars=%d keys)",
        " ".join(cmd),
        project_path,
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
            cwd=project_path,
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
