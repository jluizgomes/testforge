Scaffold a complete full-stack feature following TestForge conventions.

Arguments: $ARGUMENTS — feature name in snake_case, e.g. `notification` or `test_schedule`

This generates the boilerplate for a new feature across all layers. Follow the existing patterns exactly.

Given feature name: **$ARGUMENTS** (derive `PascalCase`, `camelCase`, `kebab-case` from it)

---

## 1. Backend: SQLAlchemy Model

File: `backend/app/models/{feature}.py`

Pattern (copy from `backend/app/models/project.py`):
- Class extends `Base, UUIDMixin, TimestampMixin`
- `__tablename__` = snake_case plural
- All columns use `Mapped[type]` with `mapped_column()`
- Add TYPE_CHECKING import for relationships if needed

## 2. Backend: Pydantic Schemas

File: `backend/app/schemas/{feature}.py`

Pattern (copy from `backend/app/schemas/project.py`):
- `{Feature}Base` — shared fields
- `{Feature}Create(Base)` — for POST
- `{Feature}Update(BaseModel)` — all Optional for PATCH
- `{Feature}Response(Base)` — adds `id`, `created_at`, `updated_at`, `model_config = ConfigDict(from_attributes=True)`

## 3. Backend: API Router

File: `backend/app/api/v1/{feature}.py`

Pattern (copy from `backend/app/api/v1/projects.py`):
- `router = APIRouter()`
- CRUD endpoints: GET list, POST create, GET by id, PATCH update, DELETE
- Use `AsyncSession` via `Depends(get_db)`
- Use `selectinload` for related objects
- 404 via `HTTPException(status_code=404)`

## 4. Register router

File: `backend/app/api/v1/__init__.py`

Add:
```python
from app.api.v1.{feature} import router as {feature}_router
router.include_router({feature}_router, prefix="/{features}", tags=["{Feature}s"])
```

## 5. Backend: Alembic Migration

File: `backend/alembic/versions/{YYYYMMDD}_0001_add_{feature}_table.py`

Use today's date. Follow the pattern from existing migrations. Include `upgrade()` and `downgrade()`.

## 6. Frontend: API Client methods

File: `src/services/api-client.ts`

Add interface `{Feature}` and CRUD methods:
```typescript
async get{Feature}s(): Promise<{Feature}[]>
async get{Feature}(id: string): Promise<{Feature}>
async create{Feature}(data: Create{Feature}Input): Promise<{Feature}>
async update{Feature}(id: string, data: Partial<Create{Feature}Input>): Promise<{Feature}>
async delete{Feature}(id: string): Promise<void>
```

## 7. Frontend: React Query Hook

File: `src/features/{feature}/hooks/use{Feature}s.ts`

Pattern (copy from `src/features/projects/hooks/useProjects.ts`):
- `use{Feature}s()` with `useQuery(['${features}'], ...)`
- `useCreate{Feature}()` with `useMutation + invalidateQueries`
- `useUpdate{Feature}()` and `useDelete{Feature}()`

## 8. Frontend: Page + Component

File: `src/features/{feature}/pages/{Feature}Page.tsx`

Pattern (copy from `src/features/projects/pages/ProjectsPage.tsx`):
- Use `shadcn/ui` Card, Table, Dialog
- Use the hook created above
- Follow the same layout as existing pages

## 9. Register route

File: `src/App.tsx`

Add route and sidebar entry following the existing pattern.

---

After showing all files to create/modify, ask the user: "Should I generate all these files now?"
