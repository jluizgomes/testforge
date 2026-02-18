"""Project API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security.encryption import encrypt_value
from app.db.session import get_db
from app.models.project import Project, ProjectConfig
from app.schemas.project import (
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    ProjectConfigResponse,
)

router = APIRouter()

_ENCRYPTED_FIELDS = {"test_login_password", "database_url"}


def _encrypt_sensitive_fields(data: dict) -> None:
    """Encrypt sensitive fields in-place before persisting."""
    for field in _ENCRYPTED_FIELDS:
        if field in data and data[field]:
            data[field] = encrypt_value(data[field])


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    """List all projects."""
    result = await db.execute(
        select(Project)
        .where(Project.is_active == True)
        .offset(skip)
        .limit(limit)
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    # Load configs for each project
    for project in projects:
        config_result = await db.execute(
            select(ProjectConfig).where(ProjectConfig.project_id == project.id)
        )
        project.config = config_result.scalar_one_or_none()

    return list(projects)


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_in: ProjectCreate,
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Create a new project."""
    # Create project
    project = Project(
        name=project_in.name,
        description=project_in.description,
        path=project_in.path,
    )
    db.add(project)
    await db.flush()

    config_created = None
    if project_in.config:
        config_created = ProjectConfig(
            project_id=project.id,
            frontend_url=project_in.config.frontend_url,
            backend_url=project_in.config.backend_url,
            openapi_url=project_in.config.openapi_url,
            database_url=encrypt_value(project_in.config.database_url) if project_in.config.database_url else None,
            redis_url=project_in.config.redis_url,
            playwright_config=project_in.config.playwright_config,
            test_timeout=project_in.config.test_timeout,
            parallel_workers=project_in.config.parallel_workers,
            retry_count=project_in.config.retry_count,
            test_login_email=project_in.config.test_login_email,
            test_login_password=encrypt_value(project_in.config.test_login_password) if project_in.config.test_login_password else None,
            ai_provider=project_in.config.ai_provider,
            ai_model=project_in.config.ai_model,
        )
        db.add(config_created)
        await db.flush()

    await db.commit()
    await db.refresh(project)
    # Project has no ORM config relationship; set for ProjectResponse serialization
    if config_created:
        await db.refresh(config_created)
        project.config = config_created
    else:
        project.config = None

    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Get a specific project by ID."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.is_active == True)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Load config
    config_result = await db.execute(
        select(ProjectConfig).where(ProjectConfig.project_id == project.id)
    )
    project.config = config_result.scalar_one_or_none()

    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_in: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Update a project."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.is_active == True)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Update project fields
    update_data = project_in.model_dump(exclude_unset=True, exclude={"config"})
    for field, value in update_data.items():
        setattr(project, field, value)

    # Update config if provided
    if project_in.config:
        config_result = await db.execute(
            select(ProjectConfig).where(ProjectConfig.project_id == project.id)
        )
        config = config_result.scalar_one_or_none()

        if config:
            config_data = project_in.config.model_dump(exclude_unset=True)
            _encrypt_sensitive_fields(config_data)
            for field, value in config_data.items():
                setattr(config, field, value)
        else:
            config_data = project_in.config.model_dump(exclude_unset=True)
            _encrypt_sensitive_fields(config_data)
            config = ProjectConfig(
                project_id=project.id,
                **config_data,
            )
            db.add(config)

    await db.commit()
    await db.refresh(project)

    # Reload config
    config_result = await db.execute(
        select(ProjectConfig).where(ProjectConfig.project_id == project.id)
    )
    project.config = config_result.scalar_one_or_none()

    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a project (soft delete)."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.is_active == True)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    project.is_active = False
    await db.commit()


@router.get("/{project_id}/config", response_model=ProjectConfigResponse)
async def get_project_config(
    project_id: str,
    db: AsyncSession = Depends(get_db),
) -> ProjectConfig:
    """Get project configuration."""
    result = await db.execute(
        select(ProjectConfig).where(ProjectConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project configuration not found",
        )

    return config
