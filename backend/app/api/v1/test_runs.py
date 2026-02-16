"""Test Run API endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.project import Project
from app.models.test_run import TestRun, TestRunStatus
from app.schemas.test_run import TestRunCreate, TestRunResponse, TestRunUpdate

router = APIRouter()


async def get_project_or_404(
    project_id: str,
    db: AsyncSession,
) -> Project:
    """Get project or raise 404."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.is_active == True)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    return project


@router.get("", response_model=list[TestRunResponse])
async def list_test_runs(
    project_id: str,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> list[TestRun]:
    """List all test runs for a project."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun)
        .where(TestRun.project_id == project_id)
        .order_by(TestRun.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    return list(result.scalars().all())


@router.post("", response_model=TestRunResponse, status_code=status.HTTP_201_CREATED)
async def create_test_run(
    project_id: str,
    run_in: TestRunCreate,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Start a new test run."""
    await get_project_or_404(project_id, db)

    test_run = TestRun(
        project_id=project_id,
        status=TestRunStatus.PENDING,
        config=run_in.config,
    )

    db.add(test_run)
    await db.commit()
    await db.refresh(test_run)

    return test_run


@router.get("/{run_id}", response_model=TestRunResponse)
async def get_test_run(
    project_id: str,
    run_id: str,
    include_results: bool = False,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Get a specific test run."""
    await get_project_or_404(project_id, db)

    query = select(TestRun).where(
        TestRun.id == run_id,
        TestRun.project_id == project_id,
    )

    if include_results:
        query = query.options(selectinload(TestRun.results))

    result = await db.execute(query)
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    return test_run


@router.patch("/{run_id}", response_model=TestRunResponse)
async def update_test_run(
    project_id: str,
    run_id: str,
    run_in: TestRunUpdate,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Update a test run."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun).where(
            TestRun.id == run_id,
            TestRun.project_id == project_id,
        )
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    update_data = run_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(test_run, field, value)

    await db.commit()
    await db.refresh(test_run)

    return test_run


@router.post("/{run_id}/start", response_model=TestRunResponse)
async def start_test_run(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Mark a test run as started."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun).where(
            TestRun.id == run_id,
            TestRun.project_id == project_id,
        )
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    if test_run.status != TestRunStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test run is not in pending state",
        )

    test_run.status = TestRunStatus.RUNNING
    test_run.started_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(test_run)

    return test_run


@router.post("/{run_id}/stop", response_model=TestRunResponse)
async def stop_test_run(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Stop a running test run."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun).where(
            TestRun.id == run_id,
            TestRun.project_id == project_id,
        )
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    if test_run.status != TestRunStatus.RUNNING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test run is not running",
        )

    test_run.status = TestRunStatus.CANCELLED
    test_run.completed_at = datetime.now(timezone.utc)

    if test_run.started_at:
        test_run.duration_ms = int(
            (test_run.completed_at - test_run.started_at).total_seconds() * 1000
        )

    await db.commit()
    await db.refresh(test_run)

    return test_run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_run(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a test run."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun).where(
            TestRun.id == run_id,
            TestRun.project_id == project_id,
        )
    )
    test_run = result.scalar_one_or_none()

    if not test_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test run not found",
        )

    await db.delete(test_run)
    await db.commit()
