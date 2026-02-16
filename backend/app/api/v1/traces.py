"""Trace API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.trace import Trace
from app.schemas.trace import TraceResponse

router = APIRouter()


@router.get("", response_model=list[TraceResponse])
async def list_traces(
    run_id: str | None = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
) -> list[Trace]:
    """List traces, optionally filtered by test run."""
    query = select(Trace).order_by(Trace.created_at.desc()).offset(skip).limit(limit)

    if run_id:
        query = query.where(Trace.test_run_id == run_id)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{trace_id}", response_model=TraceResponse)
async def get_trace(
    trace_id: str,
    include_spans: bool = True,
    db: AsyncSession = Depends(get_db),
) -> Trace:
    """Get a specific trace with its spans."""
    query = select(Trace).where(Trace.id == trace_id)

    if include_spans:
        query = query.options(selectinload(Trace.spans))

    result = await db.execute(query)
    trace = result.scalar_one_or_none()

    if not trace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trace not found",
        )

    return trace


@router.get("/by-trace-id/{trace_id}", response_model=TraceResponse)
async def get_trace_by_trace_id(
    trace_id: str,
    include_spans: bool = True,
    db: AsyncSession = Depends(get_db),
) -> Trace:
    """Get a trace by its trace_id (OpenTelemetry trace ID)."""
    query = select(Trace).where(Trace.trace_id == trace_id)

    if include_spans:
        query = query.options(selectinload(Trace.spans))

    result = await db.execute(query)
    trace = result.scalar_one_or_none()

    if not trace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trace not found",
        )

    return trace
