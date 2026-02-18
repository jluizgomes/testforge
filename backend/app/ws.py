"""WebSocket connection manager for real-time progress updates."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections grouped by job_type and job_id."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    def _key(self, job_type: str, job_id: str) -> str:
        return f"{job_type}:{job_id}"

    async def connect(self, ws: WebSocket, job_type: str, job_id: str) -> None:
        await ws.accept()
        key = self._key(job_type, job_id)
        self._connections.setdefault(key, set()).add(ws)
        logger.debug("ws: connected %s", key)

    def disconnect(self, ws: WebSocket, job_type: str, job_id: str) -> None:
        key = self._key(job_type, job_id)
        conns = self._connections.get(key)
        if conns:
            conns.discard(ws)
            if not conns:
                del self._connections[key]
        logger.debug("ws: disconnected %s", key)

    async def broadcast(self, job_type: str, job_id: str, data: dict[str, Any]) -> None:
        key = self._key(job_type, job_id)
        conns = self._connections.get(key)
        if not conns:
            return
        message = json.dumps(data)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            conns.discard(ws)
        if not conns:
            self._connections.pop(key, None)


ws_manager = ConnectionManager()


async def ws_progress_endpoint(ws: WebSocket, job_type: str, job_id: str) -> None:
    """WebSocket endpoint handler — accept and keep alive until client disconnects."""
    await ws_manager.connect(ws, job_type, job_id)
    try:
        while True:
            # Keep connection alive; client sends pings or we just wait
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws, job_type, job_id)
