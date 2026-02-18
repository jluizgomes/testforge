Scaffold a new FastAPI endpoint following TestForge backend conventions.

Arguments: $ARGUMENTS — description of the endpoint, e.g. `GET /projects/{id}/summary` or `POST /notifications`

**Analyse the argument** to determine:
- HTTP method (GET/POST/PATCH/DELETE)
- Path and path parameters
- Which router file it belongs to (based on the resource prefix)
- Whether it needs a new router file or fits in an existing one

**Existing routers and their files**:
- `/projects` → `backend/app/api/v1/projects.py`
- `/projects/{project_id}/runs` → `backend/app/api/v1/test_runs.py`
- `/ai` → `backend/app/api/v1/ai.py`
- `/reports` → `backend/app/api/v1/reports.py`
- `/scan` → `backend/app/api/v1/scanner.py`
- `/traces` → `backend/app/api/v1/traces.py`
- `/settings` → `backend/app/api/v1/settings.py`
- `/report-schedules` → `backend/app/api/v1/report_schedules.py`

**Conventions to follow**:
```python
@router.get("/{id}/summary", response_model=SomeResponse)
async def get_something(
    id: str,
    db: AsyncSession = Depends(get_db),
) -> SomeResponse:
    """Docstring describing the endpoint."""
    result = await db.execute(
        select(Model).where(Model.id == id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return SomeResponse.model_validate(item)
```

**Required patterns**:
- All async functions
- `AsyncSession` via `Depends(get_db)` — never create sessions manually
- 404 via `HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="...")`
- `response_model` always specified
- Pydantic v2: `model_validate()` not `from_orm()`
- Use `select()` from `sqlalchemy` (not legacy `session.query()`)

**Generate**:
1. The endpoint function code
2. Any new Pydantic response schema needed
3. Where exactly in the file to insert it (after which existing endpoint)
4. If it's a new resource, the full router file + `__init__.py` registration

Ask the user to confirm before writing to disk.
