Review the current unstaged/staged changes in the TestForge codebase with project-specific conventions.

Arguments: $ARGUMENTS — optional: a specific file path, PR number, or `staged`/`unstaged` to filter.

**Get the diff to review**:
```bash
# Unstaged changes (default):
git -C /Users/jluizgomes/Documents/Projetos/testforge diff 2>&1

# Staged changes:
git -C /Users/jluizgomes/Documents/Projetos/testforge diff --staged 2>&1

# Specific file:
git -C /Users/jluizgomes/Documents/Projetos/testforge diff -- {file} 2>&1
```

**Review checklist — apply to the diff**:

### Frontend (TypeScript/React)
- [ ] All backend fields use snake_case (`created_at`, not `createdAt`)
- [ ] API calls use `() => apiClient.method()` arrow function form (preserves `this`)
- [ ] New `useQuery` hooks have correct `queryKey` arrays
- [ ] `useMutation` calls `queryClient.invalidateQueries` on success
- [ ] Components use `cn()` for conditional classes, not template literals
- [ ] No hardcoded colors — use Tailwind semantic tokens (`text-muted-foreground`, `bg-destructive`, etc.)
- [ ] No `console.log` left in production code
- [ ] Error states handled (not just happy path)
- [ ] Loading states have skeleton or spinner
- [ ] No `any` type without `// eslint-disable` comment

### Backend (Python/FastAPI)
- [ ] All DB operations use `AsyncSession` — no sync operations
- [ ] New endpoints have `response_model` specified
- [ ] Uses `select()` not legacy `session.query()`
- [ ] Uses `model_validate()` not `from_orm()` (Pydantic v2)
- [ ] `HTTPException` uses `status.HTTP_xxx` constants
- [ ] No unhandled `except Exception` that swallows errors silently
- [ ] Sensitive fields (passwords, URLs with credentials) masked in responses
- [ ] New columns have a corresponding Alembic migration
- [ ] Line length ≤ 100 chars (ruff config)

### General
- [ ] No secrets, API keys, or real passwords committed
- [ ] New features have tests
- [ ] Breaking changes noted in the commit message

**Produce a structured review**:

```
Files changed: 5

✓ Looks good:
  - src/features/projects/... — correct snake_case usage
  - backend/app/schemas/project.py — proper Pydantic v2 pattern

⚠️ Suggestions:
  - src/services/api-client.ts:45 — consider adding error handling for 404
  - backend/app/api/v1/projects.py:88 — missing response_model

🔴 Issues (must fix):
  - backend/app/models/project.py — new column 'browser' added but no migration found
```
