"""Integration test for the /health endpoint.

Total: 1 test
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import _fastapi_app


@pytest.mark.asyncio
async def test_health_check_returns_status_key():
    """GET /health returns 200 with a 'status' key in the response body.

    DB and Redis connections are mocked to avoid requiring real services.
    """
    # Mock DB connection (engine.connect() as async context manager)
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(return_value=None)

    mock_engine = MagicMock()
    mock_engine.connect = MagicMock(return_value=mock_conn)
    # connect() returns an async context manager
    mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_conn.__aexit__ = AsyncMock(return_value=None)

    # Mock Redis TCP connection (asyncio.open_connection → reader/writer)
    mock_reader = AsyncMock()
    mock_reader.read = AsyncMock(return_value=b"+PONG\r\n")

    mock_writer = MagicMock()
    mock_writer.write = MagicMock()
    mock_writer.drain = AsyncMock()
    mock_writer.close = MagicMock()
    mock_writer.wait_closed = AsyncMock()

    async def fake_open_connection(*_args, **_kwargs):
        return mock_reader, mock_writer

    with (
        patch("app.main.engine", mock_engine),
        patch("asyncio.open_connection", side_effect=fake_open_connection),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=_fastapi_app), base_url="http://test"
        ) as client:
            response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "services" in data
