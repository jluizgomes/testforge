"""Report schedules API router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.report_schedule import ReportSchedule

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class ReportScheduleResponse(BaseModel):
    id: str
    project_id: str
    name: str
    cron_expr: str
    format: str
    enabled: bool
    last_run_at: str | None = None
    next_run_at: str | None = None
    run_count: int
    created_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, obj: ReportSchedule) -> "ReportScheduleResponse":
        return cls(
            id=str(obj.id),
            project_id=str(obj.project_id),
            name=obj.name,
            cron_expr=obj.cron_expr,
            format=obj.format,
            enabled=obj.enabled,
            last_run_at=obj.last_run_at.isoformat() if obj.last_run_at else None,
            next_run_at=obj.next_run_at.isoformat() if obj.next_run_at else None,
            run_count=obj.run_count,
            created_at=obj.created_at.isoformat(),
        )


class CreateScheduleRequest(BaseModel):
    project_id: str
    name: str
    cron_expr: str
    format: str = "html"
    enabled: bool = True


class UpdateScheduleRequest(BaseModel):
    name: str | None = None
    cron_expr: str | None = None
    format: str | None = None
    enabled: bool | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ReportScheduleResponse])
async def list_schedules(
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List report schedules, optionally filtered by project."""
    q = select(ReportSchedule).order_by(ReportSchedule.created_at.desc())
    if project_id:
        q = q.where(ReportSchedule.project_id == project_id)
    result = await db.execute(q)
    schedules = result.scalars().all()
    return [ReportScheduleResponse.from_orm(s) for s in schedules]


@router.post("", response_model=ReportScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    body: CreateScheduleRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new report schedule."""
    schedule = ReportSchedule(
        project_id=body.project_id,
        name=body.name,
        cron_expr=body.cron_expr,
        format=body.format,
        enabled=body.enabled,
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return ReportScheduleResponse.from_orm(schedule)


@router.patch("/{schedule_id}", response_model=ReportScheduleResponse)
async def update_schedule(
    schedule_id: str,
    body: UpdateScheduleRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing report schedule."""
    result = await db.execute(
        select(ReportSchedule).where(ReportSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if body.name is not None:
        schedule.name = body.name
    if body.cron_expr is not None:
        schedule.cron_expr = body.cron_expr
    if body.format is not None:
        schedule.format = body.format
    if body.enabled is not None:
        schedule.enabled = body.enabled

    await db.commit()
    await db.refresh(schedule)
    return ReportScheduleResponse.from_orm(schedule)


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report schedule."""
    result = await db.execute(
        select(ReportSchedule).where(ReportSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    await db.delete(schedule)
    await db.commit()
