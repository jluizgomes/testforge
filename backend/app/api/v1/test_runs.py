"""Test Run API endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.project import Project
from app.models.test_run import TestResult, TestRun, TestRunStatus
from app.schemas.test_run import TestResultResponse, TestRunCreate, TestRunListResponse, TestRunResponse, TestRunUpdate

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


@router.get("", response_model=list[TestRunListResponse])
async def list_test_runs(
    project_id: str,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> list[TestRun]:
    """List all test runs for a project (no results loaded to avoid async lazy load)."""
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
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Start a new test run and launch execution in the background."""
    from app.core.engine import run_tests_for_project

    await get_project_or_404(project_id, db)

    test_run = TestRun(
        project_id=project_id,
        status=TestRunStatus.PENDING,
        config=run_in.config,
    )

    db.add(test_run)
    await db.commit()
    await db.refresh(test_run)

    # Reload with results loaded so response serialization does not lazy-load
    result = await db.execute(
        select(TestRun)
        .where(TestRun.id == test_run.id)
        .options(selectinload(TestRun.results))
    )
    test_run = result.scalar_one()

    # Launch test execution in the background (non-blocking)
    background_tasks.add_task(run_tests_for_project, project_id, str(test_run.id))

    return test_run


@router.get("/{run_id}", response_model=TestRunResponse)
async def get_test_run(
    project_id: str,
    run_id: str,
    include_results: bool = True,
    db: AsyncSession = Depends(get_db),
) -> TestRun:
    """Get a specific test run (results always loaded to avoid async lazy load)."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestRun)
        .where(TestRun.id == run_id, TestRun.project_id == project_id)
        .options(selectinload(TestRun.results))
    )
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
    """Stop a running test run (kills the subprocess if alive)."""
    from app.core.engine import cancel_run

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

    # Kill the subprocess if it's still alive
    cancel_run(run_id)

    test_run.status = TestRunStatus.CANCELLED
    test_run.completed_at = datetime.now(timezone.utc)

    if test_run.started_at:
        test_run.duration_ms = int(
            (test_run.completed_at - test_run.started_at).total_seconds() * 1000
        )

    await db.commit()
    await db.refresh(test_run)

    # Reload with results so response serialization does not trigger async lazy load
    result = await db.execute(
        select(TestRun)
        .where(TestRun.id == run_id, TestRun.project_id == project_id)
        .options(selectinload(TestRun.results))
    )
    return result.scalar_one()


@router.get("/{run_id}/results", response_model=list[TestResultResponse])
async def list_test_results(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[TestResult]:
    """List all test results for a given run."""
    await get_project_or_404(project_id, db)

    result = await db.execute(
        select(TestResult)
        .where(TestResult.test_run_id == run_id)
        .order_by(TestResult.created_at.asc())
    )
    return list(result.scalars().all())


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
