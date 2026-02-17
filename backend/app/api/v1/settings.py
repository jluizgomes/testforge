"""Settings API endpoints — persist to backend/data/settings.json."""

import asyncio
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

router = APIRouter()

# Stored relative to the backend/ directory (two levels up from this file's package)
_SETTINGS_FILE = Path(__file__).parent.parent.parent.parent / "data" / "settings.json"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AppSettings(BaseModel):
    """Persisted application settings."""

    # AI
    ai_provider: str = "openai"
    ai_model: str = "gpt-4"
    openai_api_key: str = ""
    ollama_url: str = "http://localhost:11434"

    # Notifications
    notifications_desktop: bool = True
    notifications_sound: bool = False

    # Test Runner
    runner_parallel: bool = True
    runner_auto_retry: bool = False
    runner_screenshot_on_failure: bool = True

    # RAG
    rag_auto_index: bool = True
    rag_include_openapi: bool = True


class SettingsUpdateRequest(BaseModel):
    """Partial settings update — any subset of AppSettings fields."""

    ai_provider: str | None = None
    ai_model: str | None = None
    openai_api_key: str | None = None
    ollama_url: str | None = None
    notifications_desktop: bool | None = None
    notifications_sound: bool | None = None
    runner_parallel: bool | None = None
    runner_auto_retry: bool | None = None
    runner_screenshot_on_failure: bool | None = None
    rag_auto_index: bool | None = None
    rag_include_openapi: bool | None = None


class ConnectionValidateRequest(BaseModel):
    """Request to validate a connection."""

    type: str  # "database" | "redis" | "api"
    url: str


class ConnectionValidateResponse(BaseModel):
    """Result of a connection validation."""

    connected: bool
    latency_ms: float | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load() -> dict[str, Any]:
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not _SETTINGS_FILE.exists():
        return AppSettings().model_dump()
    try:
        return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return AppSettings().model_dump()


def _save(data: dict[str, Any]) -> None:
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=AppSettings)
async def get_settings() -> AppSettings:
    """Return persisted application settings."""
    return AppSettings(**_load())


@router.patch("", response_model=AppSettings)
async def update_settings(updates: SettingsUpdateRequest) -> AppSettings:
    """Merge partial updates into persisted settings and save."""
    current = _load()
    patch = updates.model_dump(exclude_none=True)
    current.update(patch)
    validated = AppSettings(**current)
    _save(validated.model_dump())
    return validated


@router.post("/validate", response_model=ConnectionValidateResponse)
async def validate_connection(
    request: ConnectionValidateRequest,
) -> ConnectionValidateResponse:
    """Test connectivity for database, Redis, or an arbitrary HTTP API."""
    url = request.url
    conn_type = request.type

    try:
        if conn_type == "database":
            from sqlalchemy import text
            from sqlalchemy.ext.asyncio import create_async_engine

            if "postgresql://" in url and "+asyncpg" not in url:
                url = url.replace("postgresql://", "postgresql+asyncpg://")

            start = time.monotonic()
            test_engine = create_async_engine(url, pool_size=1, max_overflow=0)
            try:
                async with test_engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
            finally:
                await test_engine.dispose()
            latency = round((time.monotonic() - start) * 1000, 2)
            return ConnectionValidateResponse(connected=True, latency_ms=latency)

        elif conn_type == "redis":
            parsed = urlparse(url)
            host = parsed.hostname or "localhost"
            port = parsed.port or 6379

            start = time.monotonic()
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=5.0
            )
            writer.write(b"*1\r\n$4\r\nPING\r\n")
            await writer.drain()
            response = await asyncio.wait_for(reader.read(128), timeout=5.0)
            writer.close()
            await writer.wait_closed()
            latency = round((time.monotonic() - start) * 1000, 2)

            if b"PONG" in response:
                return ConnectionValidateResponse(connected=True, latency_ms=latency)
            return ConnectionValidateResponse(
                connected=False, error="Unexpected response from Redis"
            )

        elif conn_type == "api":
            import httpx

            start = time.monotonic()
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
            latency = round((time.monotonic() - start) * 1000, 2)
            return ConnectionValidateResponse(
                connected=resp.status_code < 500,
                latency_ms=latency,
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown connection type '{conn_type}'. Use 'database', 'redis', or 'api'.",
            )

    except HTTPException:
        raise
    except Exception as exc:
        return ConnectionValidateResponse(connected=False, error=str(exc))
