"""FastAPI application entry point."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Callable
from urllib.parse import urlparse

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from sqlalchemy import text, update as sa_update

from app.api.v1 import router as api_v1_router
from app.config import settings
from app.db.session import engine, init_db
try:
    from app.ws import ws_progress_endpoint
except Exception:
    ws_progress_endpoint = None  # type: ignore[assignment]


async def _recover_orphaned_jobs() -> None:
    """Mark jobs stuck in running/scanning state as FAILED after a server restart."""
    from app.db.session import async_session_factory
    from app.models.scanner import ScanJob, ScanJobStatus
    from app.models.test_run import TestRun, TestRunStatus

    logger = logging.getLogger("app.main")
    async with async_session_factory() as db:
        # Recover stuck scan jobs
        scan_result = await db.execute(
            sa_update(ScanJob)
            .where(ScanJob.status.in_([
                ScanJobStatus.PENDING,
                ScanJobStatus.SCANNING,
                ScanJobStatus.GENERATING,
            ]))
            .values(status=ScanJobStatus.FAILED, error_message="Server restarted during scan")
            .returning(ScanJob.id)
        )
        scan_ids = [str(r[0]) for r in scan_result.all()]

        # Recover stuck test runs
        run_result = await db.execute(
            sa_update(TestRun)
            .where(TestRun.status.in_([
                TestRunStatus.PENDING,
                TestRunStatus.RUNNING,
            ]))
            .values(status=TestRunStatus.FAILED, error_message="Server restarted during run")
            .returning(TestRun.id)
        )
        run_ids = [str(r[0]) for r in run_result.all()]

        await db.commit()

        if scan_ids:
            logger.warning("Recovered %d orphaned scan job(s): %s", len(scan_ids), scan_ids)
        if run_ids:
            logger.warning("Recovered %d orphaned test run(s): %s", len(run_ids), run_ids)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context manager."""
    # Startup
    await init_db()
    await _recover_orphaned_jobs()
    yield
    # Shutdown
    await engine.dispose()


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Intelligent E2E Testing Platform with AI-powered test generation and analysis",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    # CORS: ensure headers on every response (including 500) so browser doesn't block
    origins = list(settings.cors_origins)

    class EnsureCORSHeadersMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            response = await call_next(request)
            origin = request.headers.get("origin")
            if origin and origin in origins and not response.headers.get("access-control-allow-origin"):
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
            return response

    app.add_middleware(EnsureCORSHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Any, exc: Exception) -> JSONResponse:
        """Return JSON 500 so CORS headers are applied to error responses."""
        logging.getLogger("app.main").exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    # Health check endpoint
    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, Any]:
        """Health check endpoint with real DB and Redis connectivity checks."""
        result: dict[str, Any] = {
            "status": "healthy",
            "version": settings.app_version,
            "services": {},
        }

        # Check Database
        try:
            start = time.monotonic()
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            db_latency_ms = round((time.monotonic() - start) * 1000, 2)
            result["services"]["database"] = {
                "status": "healthy",
                "latency_ms": db_latency_ms,
            }
        except Exception as exc:
            result["services"]["database"] = {
                "status": "unhealthy",
                "error": str(exc),
            }
            result["status"] = "degraded"

        # Check Redis via raw TCP PING
        try:
            parsed = urlparse(settings.redis_url)
            host = parsed.hostname or "localhost"
            port = parsed.port or 6379

            start = time.monotonic()
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=3.0
            )
            writer.write(b"*1\r\n$4\r\nPING\r\n")
            await writer.drain()
            response = await asyncio.wait_for(reader.read(128), timeout=3.0)
            writer.close()
            await writer.wait_closed()
            redis_latency_ms = round((time.monotonic() - start) * 1000, 2)

            if b"PONG" in response:
                result["services"]["redis"] = {
                    "status": "healthy",
                    "latency_ms": redis_latency_ms,
                }
            else:
                result["services"]["redis"] = {
                    "status": "unhealthy",
                    "error": "Unexpected response from Redis",
                }
                result["status"] = "degraded"
        except Exception as exc:
            result["services"]["redis"] = {
                "status": "unhealthy",
                "error": str(exc),
            }
            result["status"] = "degraded"

        return result

    # WebSocket endpoint for real-time progress updates
    if ws_progress_endpoint is not None:
        @app.websocket("/ws/progress/{job_type}/{job_id}")
        async def ws_progress(websocket: WebSocket, job_type: str, job_id: str) -> None:
            await ws_progress_endpoint(websocket, job_type, job_id)

    # Include API routers
    app.include_router(api_v1_router, prefix="/api/v1")

    # Serve screenshot files captured by Playwright
    screenshots_dir = Path("./screenshots")
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/screenshots", StaticFiles(directory=str(screenshots_dir)), name="screenshots")

    return app


app = create_application()
