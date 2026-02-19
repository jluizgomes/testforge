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
import re
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

# ── Docker host-gateway URL fixup ─────────────────────────────────────────────
# When the backend runs inside Docker, "localhost" in URLs refers to the
# container itself, not the host machine. On Docker Desktop (Mac/Windows),
# host.docker.internal resolves to the host, so services like the aurora
# backend (running on host port 8000) become reachable from the container.
_IS_DOCKER = Path("/.dockerenv").exists()
_LOCALHOST_RE = re.compile(r"(https?://)(localhost|127\.0\.0\.1)(:\d+)")


def _fix_host_url(url: str) -> str:
    """Replace localhost/127.0.0.1 with host.docker.internal when in Docker.

    No-op outside Docker or for non-HTTP(S) values.
    """
    if not _IS_DOCKER or not url.startswith(("http://", "https://")):
        return url
    return _LOCALHOST_RE.sub(r"\1host.docker.internal\3", url)


# ── Per-project virtualenv ────────────────────────────────────────────────────
# Each synced workspace gets its own isolated venv at:
#   workspace/{project_id}/.testforge_venv/
# The venv is created on the first test run and rebuilt when requirements change.
# All paths are made ABSOLUTE before use so that subprocess with a different
# cwd does not mis-resolve relative executables.

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


async def _stream_install_cmd(
    cmd: list[str],
    run_id: str | None,
    label: str,
    timeout: float = 300.0,
) -> tuple[bool, str]:
    """Run an install command, streaming each output line as a WebSocket log message.

    Returns (success, combined_stderr_text).
    """
    if run_id:
        await _broadcast_run(run_id, {"log": f"[install] {label}"})
    logger.info("engine: %s", label)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []

    async def _drain(stream: asyncio.StreamReader, buf: list[str]) -> None:
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                buf.append(line)
                if run_id:
                    await _broadcast_run(run_id, {"log": f"  {line}"})

    t_out = asyncio.create_task(_drain(proc.stdout, stdout_lines))  # type: ignore[arg-type]
    t_err = asyncio.create_task(_drain(proc.stderr, stderr_lines))  # type: ignore[arg-type]
    try:
        await asyncio.wait_for(asyncio.gather(t_out, t_err), timeout=timeout)
    except asyncio.TimeoutError:
        t_out.cancel()
        t_err.cancel()
        proc.kill()
        if run_id:
            await _broadcast_run(run_id, {"log": "[install] ⚠ Timed out after 5 minutes"})
        return False, "Timed out"

    await proc.wait()
    returncode = proc.returncode or 0
    success = returncode == 0

    if not success:
        err_tail = "\n".join((stdout_lines + stderr_lines)[-5:])
        if run_id:
            await _broadcast_run(run_id, {"log": f"[install] ⚠ Exited {returncode}: {err_tail[:300]}"})
        logger.warning("engine: install exited %s: %s", returncode, "\n".join(stderr_lines)[:300])
    else:
        if run_id:
            await _broadcast_run(run_id, {"log": "[install] ✓ Done"})

    return success, "\n".join(stderr_lines)


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
    """MD5 fingerprint of all requirements files found in *workspace_path*."""
    h = hashlib.md5()
    for fname in (
        "requirements.txt",
        "requirements-dev.txt",
        "requirements-test.txt",
        "pyproject.toml",
        "setup.cfg",
        "setup.py",
    ):
        for search_dir in [workspace_path, workspace_path / "backend", workspace_path / "api"]:
            f = search_dir / fname
            if f.exists():
                try:
                    h.update(str(f.relative_to(workspace_path)).encode())
                    h.update(f.read_bytes())
                except OSError:
                    pass
    return h.hexdigest()


# Import names that map to a different PyPI package name
_IMPORT_TO_PKG: dict[str, str] = {
    "dotenv": "python-dotenv",
    "pil": "Pillow",
    "yaml": "PyYAML",
    "cv2": "opencv-python",
    "sklearn": "scikit-learn",
    "bs4": "beautifulsoup4",
    "dateutil": "python-dateutil",
    "jose": "python-jose",
    "jwt": "PyJWT",
    "magic": "python-magic",
    "attr": "attrs",
}

# Top-level names that are stdlib, pytest internals, or local app packages
_STDLIB_NAMES: frozenset[str] = frozenset({
    "os", "sys", "re", "io", "json", "time", "datetime", "pathlib", "typing",
    "collections", "itertools", "functools", "math", "random", "string", "uuid",
    "asyncio", "threading", "subprocess", "shutil", "tempfile", "hashlib",
    "base64", "urllib", "http", "email", "abc", "copy", "enum", "dataclasses",
    "logging", "warnings", "traceback", "contextlib", "unittest", "decimal",
    "struct", "socket", "signal", "platform", "inspect", "importlib", "types",
    "weakref", "gc", "atexit", "builtins", "operator", "stat", "fnmatch",
    # test framework (installed separately as essentials)
    "pytest", "anyio", "pytest_asyncio",
    # local app packages (not installable, code is in workspace)
    "app", "tests", "backend", "api", "conftest", "__future__",
})

_SKIP_VENV_DIRS: frozenset[str] = frozenset({".testforge_venv", "node_modules", ".git", "__pycache__"})


def _collect_test_dependencies(workspace_abs: Path) -> list[str]:
    """Return requirement specs from the project's requirements files, skipping
    known-heavy packages (torch, tensorflow, opencv, etc.) that tests almost never
    need and that would take many minutes to download.

    This is a 'full minus heavy' strategy: install everything from requirements.txt
    except the packages that are too large or require GPU/system libs.
    """
    # Normalized package names that are too large/slow to install in a test venv.
    # These require GPU drivers, system libs, or take >5 min to download.
    _HEAVY: frozenset[str] = frozenset({
        "torch", "torchvision", "torchaudio", "torchtext", "torch_geometric",
        "tensorflow", "tensorflow_cpu", "tensorflow_gpu", "tf_keras",
        "keras", "jax", "flax", "trax",
        "scikit_learn", "scipy", "statsmodels",
        "opencv_python", "opencv_python_headless", "opencv_contrib_python",
        "matplotlib", "seaborn", "plotly", "bokeh", "altair",
        "transformers", "diffusers", "accelerate", "peft", "trl", "bitsandbytes",
        "xgboost", "lightgbm", "catboost",
        "spacy", "nltk", "gensim", "flair",
        "librosa", "soundfile", "audioread", "pyaudio", "pydub", "noisereduce",
        "numba", "cupy", "cupy_cuda", "triton",
        "sentence_transformers", "faiss_cpu", "faiss_gpu", "chromadb",
        "llama_cpp_python", "ctransformers",
        "paddle", "paddlepaddle",
        "mmcv", "mmdet", "mmsegmentation",
        "detectron2",
    })

    req_name_re = re.compile(r"^([A-Za-z0-9_\-\.]+)")
    result: list[str] = []
    seen: set[str] = set()

    for fname in ("requirements.txt", "requirements-test.txt", "requirements-dev.txt"):
        for search_dir in [workspace_abs, workspace_abs / "backend", workspace_abs / "api"]:
            req_f = search_dir / fname
            if not req_f.exists():
                continue
            try:
                for line in req_f.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith(("#", "-r ", "-c ", "git+", "http", "--")):
                        continue
                    m = req_name_re.match(line)
                    if not m:
                        continue
                    norm = m.group(1).lower().replace("-", "_").replace(".", "_")
                    if norm in seen or norm in _HEAVY:
                        continue
                    seen.add(norm)
                    result.append(line.split("#")[0].strip())  # strip inline comments
            except OSError:
                pass

    logger.info(
        "engine: collected %d requirement specs (excluded %d heavy packages)",
        len(result),
        len([n for n in seen if n in _HEAVY]),
    )
    return result


async def _ensure_project_venv(
    workspace_path: Path,
    run_id: str | None = None,
) -> Path | None:
    """Create or update a per-project virtualenv inside the synced workspace.

    Uses a **smart install strategy** to avoid installing the entire
    requirements.txt (which may contain heavy ML packages like torch that
    have nothing to do with the test suite).

    Phase 1 — always install pytest essentials (fast, ~5–10s).
    Phase 2 — install project requirements minus known-heavy packages.

    All returned paths are absolute so that asyncio.create_subprocess_exec
    resolves the executable correctly regardless of the subprocess cwd.

    Install progress is streamed via WebSocket when *run_id* is provided.
    """
    workspace_abs = workspace_path.resolve()
    venv_dir = workspace_abs / ".testforge_venv"
    python_bin = venv_dir / "bin" / "python"
    pip_bin = venv_dir / "bin" / "pip"
    hash_file = venv_dir / ".req_hash"

    current_hash = _req_hash(workspace_abs)

    # Skip if venv is up to date
    if python_bin.exists() and hash_file.exists():
        try:
            if hash_file.read_text().strip() == current_hash:
                logger.info("engine: project venv up to date at %s", venv_dir)
                if run_id:
                    await _broadcast_run(run_id, {"log": "[env] Project environment is up to date — skipping install"})
                return venv_dir / "bin"
        except OSError:
            pass

    # Create the virtualenv
    if run_id:
        await _broadcast_run(run_id, {"log": "[env] Creating isolated Python environment…"})

    venv_ok, _ = await _stream_install_cmd(
        [sys.executable, "-m", "venv", str(venv_dir)],
        run_id,
        "python -m venv .testforge_venv",
        timeout=120.0,
    )
    if not venv_ok:
        return None

    install_ok = True
    uv_bin = venv_dir / "bin" / "uv"

    # Phase 1: pytest essentials — always installed, very fast (~5–10s).
    # httpx is included because starlette.testclient (used by FastAPI tests) requires it.
    essentials = [
        "pytest", "pytest-asyncio", "pytest-json-report", "anyio[asyncio]", "httpx",
        "uv",  # install uv so Phase 2 can use it (10-100x faster than pip)
    ]
    phase1_ok, _ = await _stream_install_cmd(
        [str(pip_bin), "install"] + essentials,
        run_id,
        f"Phase 1 — test essentials: {', '.join(essentials[:4])}…",
        timeout=300.0,
    )
    if not phase1_ok:
        install_ok = False

    # Phase 2: project requirements minus known-heavy packages.
    # If uv is available after Phase 1, use it for dramatic speed improvement.
    test_deps = _collect_test_dependencies(workspace_abs)
    if test_deps:
        if uv_bin.exists():
            phase2_cmd = [
                str(uv_bin), "pip", "install",
                "--python", str(python_bin),
            ] + test_deps
        else:
            phase2_cmd = [str(pip_bin), "install"] + test_deps

        phase2_ok, _ = await _stream_install_cmd(
            phase2_cmd,
            run_id,
            f"Phase 2 — {len(test_deps)} project deps via {'uv' if uv_bin.exists() else 'pip'}",
            timeout=300.0,
        )
        if not phase2_ok:
            install_ok = False
    elif run_id:
        await _broadcast_run(run_id, {"log": "[env] No project requirements found — skipping Phase 2"})

    # Only stamp the hash when all installs succeeded.
    # A missing hash forces a retry on the next run.
    if install_ok:
        try:
            hash_file.write_text(current_hash)
        except OSError:
            pass
    else:
        logger.warning(
            "engine: dep install incomplete for %s — hash NOT stamped, will retry next run",
            venv_dir,
        )

    logger.info("engine: project venv ready at %s (complete=%s)", venv_dir, install_ok)
    if run_id:
        await _broadcast_run(run_id, {"log": f"[env] Environment ready (complete={install_ok})"})
    return venv_dir / "bin"


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

    # Playwright (TypeScript / JavaScript) — root and common subdirs (including monorepo layouts)
    playwright_configs = ("playwright.config.ts", "playwright.config.js", "playwright.config.mjs")
    search_dirs: list[Path] = [base]
    for sub in ("e2e", "tests", "tests/e2e", "playwright", "e2e/tests", "frontend", "app", "apps/web", "packages/e2e"):
        d = base / sub
        if d.is_dir():
            search_dirs.append(d)
    # One more level: e.g. apps/web/e2e, packages/e2e/tests
    for sub in list(search_dirs):
        if sub != base:
            for sub2 in ("e2e", "tests", "playwright"):
                d2 = sub / sub2
                if d2.is_dir():
                    search_dirs.append(d2)
    # Only use Playwright if npx is actually available in the container.
    # If running in a Python-only Docker image, npx won't be installed and
    # trying to exec it causes [Errno 2] No such file or directory.
    npx = shutil.which("npx")
    if npx:
        for root in search_dirs:
            for cfg in playwright_configs:
                if (root / cfg).exists():
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
        # Glob for playwright.config.* anywhere under base (max depth 4 for monorepos)
        try:
            for path in base.rglob("playwright.config.*"):
                if path.suffix in (".ts", ".js", ".mjs") and path.is_file():
                    try:
                        if len(path.relative_to(base).parts) > 4:
                            continue
                    except ValueError:
                        continue
                    root = path.parent
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
        except OSError:
            pass
    else:
        logger.info(
            "engine: npx not found in PATH — skipping Playwright detection "
            "(install Node.js in the container to enable frontend tests)"
        )

    # pytest — search root first, then common monorepo backend subdirs.
    # Also treat requirements.txt as a fallback indicator (project may lack explicit
    # config but still be runnable with pytest after workspace scaffolding).
    _pytest_cfgs = (
        "pyproject.toml", "setup.cfg", "pytest.ini", "setup.py",
        "conftest.py", "requirements.txt",
    )
    _pytest_search: list[Path] = [base]
    for _sub in ("backend", "api", "server", "src", "app", "lib", "tests"):
        _d = base / _sub
        if _d.is_dir():
            _pytest_search.append(_d)

    for _pytest_dir in _pytest_search:
        for cfg in _pytest_cfgs:
            if (_pytest_dir / cfg).exists():
                # Prefer the project venv's pytest (absolute path — critical!).
                # Using a relative path here would be resolved from the subprocess cwd,
                # not the backend cwd, causing [Errno 2] No such file or directory.
                if venv_bin is not None:
                    venv_pytest = (venv_bin / "pytest").resolve()
                    if venv_pytest.exists():
                        pytest_bin = str(venv_pytest)
                    else:
                        # venv exists but pytest not yet installed — fall back
                        pytest_bin = shutil.which("pytest") or sys.executable + " -m pytest"
                else:
                    pytest_bin = shutil.which("pytest") or sys.executable + " -m pytest"
                # If pytest_bin contains a space (the "-m pytest" fallback), split it
                if " " in pytest_bin:
                    cmd = pytest_bin.split() + ["--json-report", "--json-report-file=-", "-q"]
                else:
                    cmd = [pytest_bin, "--json-report", "--json-report-file=-", "-q"]
                if parallel_workers > 1:
                    cmd += ["-n", str(parallel_workers)]
                if retry_count > 0:
                    cmd += [f"--count={retry_count}"]
                if test_timeout != 30000:
                    cmd += [f"--timeout={test_timeout // 1000}"]
                logger.info(
                    "engine: detected pytest config %s in %s",
                    cfg,
                    _pytest_dir.relative_to(base) if _pytest_dir != base else "(root)",
                )
                return "backend", cmd, str(_pytest_dir)

    # package.json test script — only if npm is available
    npm = shutil.which("npm")
    if npm:
        pkg = base / "package.json"
        if pkg.exists():
            try:
                data = json.loads(pkg.read_text())
                scripts = data.get("scripts", {})
                if "test" in scripts:
                    return "frontend", [npm, "run", "test", "--", "--reporter=json"], str(base)
            except Exception:
                pass

    try:
        top = sorted(base.iterdir(), key=lambda p: p.name)[:15]
        found = ", ".join(p.name for p in top) or "(empty)"
    except Exception:
        found = "(could not list)"
    raise RuntimeError(
        f"Could not detect test runner at {project_path}. "
        "Supported: Playwright (playwright.config.* in root or e2e/tests), "
        "pytest (pyproject.toml/conftest.py), or npm test script. "
        f"Top-level contents: {found}. "
        "If using a synced workspace, run Sync Now and ensure the project has one of the above."
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
    """Parse pytest --json-report stdout into a list of result dicts.

    Stdout may contain pytest progress output before the JSON; find the last {...}.
    """
    results: list[dict[str, Any]] = []
    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.rfind("{")
        if start != -1:
            try:
                data = json.loads(raw[start:])
            except json.JSONDecodeError:
                pass
    if not data:
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


async def _try_get_auth_token(backend_url: str, email: str, password: str) -> str | None:
    """Attempt to authenticate with the project's backend and return a JWT token.

    Tries the most common login endpoint patterns used by FastAPI / Django / Rails
    projects. Returns None if authentication fails or the backend is unreachable.
    """
    try:
        import httpx
    except ImportError:
        return None

    # (endpoint, json_body) pairs — tried in order
    candidates = [
        ("/api/v1/auth/login",  {"email": email, "password": password}),
        ("/api/v1/auth/token",  {"username": email, "password": password}),
        ("/api/auth/login",     {"email": email, "password": password}),
        ("/api/auth/token",     {"username": email, "password": password}),
        ("/auth/login",         {"email": email, "password": password}),
        ("/api/token",          {"username": email, "password": password}),
    ]

    base = backend_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            for path, body in candidates:
                try:
                    resp = await client.post(f"{base}{path}", json=body)
                except Exception:
                    continue
                if resp.status_code not in (200, 201):
                    continue
                try:
                    data = resp.json()
                except Exception:
                    continue
                # Handle common token structures
                token = (
                    data.get("access_token")
                    or data.get("token")
                    or data.get("accessToken")
                    or (data.get("data") or {}).get("access_token")
                    or (data.get("tokens") or {}).get("access")
                )
                if token:
                    logger.info("engine: auth token obtained from %s%s", base, path)
                    return str(token)
    except Exception as exc:
        logger.debug("engine: _try_get_auth_token failed: %s", exc)

    return None


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

    # ── Inject project credentials + auth token ───────────────────────────────
    # Projects often require authentication (e.g. Aurora Language Center).
    # Inject credentials as env vars so test suites can use them directly,
    # and try to obtain a JWT token via the project's login endpoint.
    if config:
        from app.core.security.encryption import decrypt_value
        email = config.test_login_email or ""
        password = ""
        if config.test_login_password:
            try:
                password = decrypt_value(config.test_login_password)
            except Exception:
                password = config.test_login_password  # use as-is if not encrypted

        if email and "TEST_LOGIN_EMAIL" not in env_vars:
            env_vars["TEST_LOGIN_EMAIL"] = email
        if password and "TEST_LOGIN_PASSWORD" not in env_vars:
            env_vars["TEST_LOGIN_PASSWORD"] = password

        backend_url = _fix_host_url(config.backend_url or "")
        if backend_url:
            if "BACKEND_URL" not in env_vars:
                env_vars["BACKEND_URL"] = backend_url
            if "API_BASE_URL" not in env_vars:
                env_vars["API_BASE_URL"] = backend_url

        if config.frontend_url:
            frontend_url = _fix_host_url(config.frontend_url)
            if "FRONTEND_URL" not in env_vars:
                env_vars["FRONTEND_URL"] = frontend_url

        # Try to obtain a JWT token so tests don't need to log in themselves
        if email and password and backend_url and "TEST_AUTH_TOKEN" not in env_vars:
            token = await _try_get_auth_token(backend_url, email, password)
            if token:
                env_vars["TEST_AUTH_TOKEN"] = token
                env_vars["ACCESS_TOKEN"] = token
                env_vars["AUTHORIZATION"] = f"Bearer {token}"
                logger.info("engine: injected auth token for project %s", project_id)

    project_path = _get_effective_path(str(project.id), project.path)

    # ── Mark run as RUNNING early so install logs appear in the frontend ──────
    run_result = await db.execute(select(TestRun).where(TestRun.id == run_id))
    test_run: TestRun | None = run_result.scalar_one_or_none()
    if not test_run:
        logger.error("engine: run %s not found", run_id)
        return

    test_run.status = TestRunStatus.RUNNING
    test_run.started_at = started
    await db.commit()
    await _broadcast_run(run_id, {"status": "running", "progress": 0})

    # ── Per-project venv + workspace env vars (only when workspace is synced) ──
    venv_bin: Path | None = None
    # Use absolute path for all workspace operations to avoid cwd-relative issues
    ws_path = (Path("workspace") / str(project.id)).resolve()
    is_workspace = project_path == str(ws_path) or project_path == str(Path("workspace") / str(project.id))

    if is_workspace:
        # 1. Auto-load .env vars from the synced workspace.
        #    Explicit project config always takes precedence (don't override).
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
                        if key and key not in env_vars:
                            # Translate localhost URLs so Docker tests can reach host services
                            env_vars[key] = _fix_host_url(val)
                    logger.info("engine: loaded env from %s", dotenv_file)
                except OSError:
                    pass

        # 2. Create/update per-project isolated venv with absolute paths.
        #    Pass run_id so install output streams to the Test Logs panel.
        try:
            venv_bin = await _ensure_project_venv(ws_path, run_id)
        except Exception as exc:
            logger.warning("engine: venv setup failed (will use system python): %s", exc)

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

    # ── Pre-flight: verify executable and cwd exist before launching ──────────
    exec_path = Path(cmd[0])
    if not exec_path.is_absolute():
        # For PATH-resolved executables (pytest, npx, npm) double-check they exist
        exec_path = Path(shutil.which(cmd[0]) or cmd[0])
    if not exec_path.exists():
        msg = (
            f"Executable not found: {cmd[0]!r}. "
            "If running in Docker, ensure Node.js/npm is installed for frontend tests, "
            "or use a synced workspace so the backend venv pytest can be used."
        )
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = msg
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {"status": "failed", "error_message": msg})
        logger.error("engine: %s", msg)
        return
    if not Path(run_cwd).is_dir():
        msg = f"Test working directory not found: {run_cwd!r}"
        test_run.status = TestRunStatus.FAILED
        test_run.error_message = msg
        test_run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await _broadcast_run(run_id, {"status": "failed", "error_message": msg})
        logger.error("engine: %s", msg)
        return

    logger.info(
        "engine: running %s in cwd=%s (env_vars=%d keys)",
        " ".join(cmd),
        run_cwd,
        len(env_vars),
    )
    await _broadcast_run(run_id, {"log": f"[run] {' '.join(cmd[:2])} in {run_cwd}"})

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
        # pytest-json-report may write to .report.json when stdout is not used
        if not parsed and run_cwd:
            for report_file in (Path(run_cwd) / ".report.json", Path(run_cwd) / "report.json"):
                if report_file.exists():
                    try:
                        parsed = _parse_pytest_output(report_file.read_text(encoding="utf-8"))
                        if parsed:
                            break
                    except OSError:
                        pass

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
