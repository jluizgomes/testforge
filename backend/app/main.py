"""FastAPI application entry point."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Callable
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, WebSocket
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
    # In development, allow any localhost origin so Vite (e.g. 5173) always works
    cors_kw: dict[str, Any] = {
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
        "expose_headers": ["*"],
    }
    if settings.environment == "development":
        cors_kw["allow_origin_regex"] = r"http://(localhost|127\.0\.0\.1)(:\d+)?"
        cors_kw["allow_origins"] = origins  # still use list for explicit origins
    else:
        cors_kw["allow_origins"] = origins

    def _is_allowed_origin(origin: str | None) -> bool:
        if not origin:
            return False
        if origin in origins:
            return True
        # Always allow localhost/127.0.0.1 so dev and Docker work without env tweaks
        if "localhost" in origin or "127.0.0.1" in origin:
            return True
        if settings.environment == "development" and ("localhost" in origin or "127.0.0.1" in origin):
            return True
        return False

    def _cors_headers(origin: str) -> dict[str, str]:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
        }

    class PreflightCORSMiddleware(BaseHTTPMiddleware):
        """Respond to OPTIONS preflight with CORS headers so browser never blocks."""
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            if request.method.upper() == "OPTIONS":
                origin = request.headers.get("origin") or ""
                allow_origin = origin if _is_allowed_origin(origin) else "http://localhost:5173"
                return Response(status_code=200, headers=_cors_headers(allow_origin))
            return await call_next(request)

    class EnsureCORSHeadersMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            response = await call_next(request)
            origin = request.headers.get("origin")
            if origin and _is_allowed_origin(origin):
                for k, v in _cors_headers(origin).items():
                    response.headers[k] = v
            return response

    # Outermost middleware runs last on response — add CORS to every response (including 401 from any layer)
    class FinalCORSResponseMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            response = await call_next(request)
            origin = request.headers.get("origin")
            if origin and _is_allowed_origin(origin):
                for k, v in _cors_headers(origin).items():
                    response.headers[k] = v
            return response

    # Order: last added runs first on request / last on response. FinalCORS sees every response last.
    app.add_middleware(EnsureCORSHeadersMiddleware)
    app.add_middleware(CORSMiddleware, **cors_kw)
    app.add_middleware(PreflightCORSMiddleware)
    app.add_middleware(FinalCORSResponseMiddleware)

    def _add_cors_to_response(response: Response, request: Request) -> None:
        origin = request.headers.get("origin")
        if _is_allowed_origin(origin):
            for k, v in _cors_headers(origin).items():
                response.headers[k] = v

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
        """Ensure 404 and other HTTP errors include CORS headers."""
        response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        _add_cors_to_response(response, request)
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> Response:
        """Return JSON 500 so CORS headers are applied to error responses."""
        logging.getLogger("app.main").exception("Unhandled exception: %s", exc)
        response = JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )
        _add_cors_to_response(response, request)
        return response

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


def _get_origin_from_scope(scope: dict) -> str | None:
    if scope.get("type") != "http":
        return None
    for (key, value) in scope.get("headers", []):
        if key.lower() == b"origin":
            return value.decode("utf-8", errors="replace")
    return None


def _is_allowed_origin_cors(origin: str | None) -> bool:
    if not origin:
        return False
    if "localhost" in origin or "127.0.0.1" in origin:
        return True
    origins = list(settings.cors_origins)
    if origin in origins:
        return True
    return False


def _cors_headers_list(origin: str) -> list[tuple[bytes, bytes]]:
    return [
        (b"access-control-allow-origin", origin.encode()),
        (b"access-control-allow-credentials", b"true"),
        (b"access-control-allow-methods", b"GET, POST, PUT, PATCH, DELETE, OPTIONS"),
        (b"access-control-allow-headers", b"*"),
        (b"access-control-max-age", b"86400"),
    ]


class ASGICORSWrapper:
    """Outermost ASGI wrapper: handle OPTIONS preflight and add CORS to every response."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        origin = _get_origin_from_scope(scope)
        allowed = _is_allowed_origin_cors(origin)
        allow_origin = (origin if allowed else None) or "http://localhost:5173"

        if scope.get("method", "").upper() == "OPTIONS":
            headers = _cors_headers_list(allow_origin)
            await send({"type": "http.response.start", "status": 200, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
            return

        response_origin = origin if _is_allowed_origin_cors(origin) else None

        async def send_with_cors(message: dict) -> None:
            if message["type"] == "http.response.start" and response_origin:
                headers = list(message.get("headers", []))
                headers = [(k, v) for k, v in headers if k.lower() != b"access-control-allow-origin"]
                headers.extend(_cors_headers_list(response_origin))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)


_fastapi_app = create_application()
app = ASGICORSWrapper(_fastapi_app)
