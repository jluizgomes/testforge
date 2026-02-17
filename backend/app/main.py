"""FastAPI application entry point."""

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import router as api_v1_router
from app.config import settings
from app.db.session import engine, init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context manager."""
    # Startup
    await init_db()
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

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
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

    # Include API routers
    app.include_router(api_v1_router, prefix="/api/v1")

    # Serve screenshot files captured by Playwright
    screenshots_dir = Path("./screenshots")
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/screenshots", StaticFiles(directory=str(screenshots_dir)), name="screenshots")

    return app


app = create_application()
