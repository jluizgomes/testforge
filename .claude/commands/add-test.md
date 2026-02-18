Generate a test for an existing function, component, or API endpoint following TestForge test conventions.

Arguments: $ARGUMENTS — file path or description of what to test, e.g. `src/services/api-client.ts getProjects` or `backend/app/api/v1/projects.py`

**Detect the type of test needed** from the argument:
- `src/**/*.ts(x)` → Vitest unit/component test
- `backend/app/api/**/*.py` → pytest integration test (uses `AsyncClient`)
- `backend/app/core/**/*.py` or `backend/app/reports/**` → pytest unit test

---

## Frontend test conventions (Vitest)

Reference: `src/services/api-client.test.ts` and `src/stores/app-store.test.ts`

```typescript
// File: src/features/.../__tests__/{name}.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('{subject}', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should ...', () => {
    // Arrange
    // Act
    // Assert
    expect(...).toBe(...)
  })
})
```

- Mock API calls with `vi.spyOn(apiClient, 'methodName')`
- Use `@testing-library/react` for component tests
- `localStorage` mock is already in `src/test/setup.ts`
- Tests live next to source files or in `__tests__/` subfolders

## Backend test conventions (pytest)

Reference: `backend/tests/integration/test_projects_api.py` and `backend/tests/unit/test_ai_agents.py`

```python
# File: backend/tests/{unit|integration}/test_{module}.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_{action}(client: AsyncClient):
    """Test that..."""
    # Arrange
    # Act
    response = await client.post("/api/v1/...", json={...})
    # Assert
    assert response.status_code == 200
    data = response.json()
    assert data["field"] == expected
```

- `client` fixture is in `backend/tests/conftest.py`
- Use `pytest.mark.asyncio` for async tests
- Unit tests mock with `unittest.mock.AsyncMock` / `patch`
- Integration tests use real DB via `conftest.py` test session

**Generate**:
1. Read the target file to understand what needs testing
2. Write comprehensive tests covering: happy path, edge cases, error paths
3. Aim for 5–10 test cases
4. Place the test file in the correct directory

After generating, run the new test to verify it passes:
```bash
# Frontend:
npx vitest run {test_file_path}
# Backend:
cd backend && python -m pytest {test_file_path} -v
```
