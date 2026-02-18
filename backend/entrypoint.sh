#!/bin/bash
set -e

echo "[entrypoint] Running Alembic migrations..."
alembic upgrade head
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
