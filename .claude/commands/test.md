Run the TestForge test suite — backend (pytest) and/or frontend (vitest).

Arguments: $ARGUMENTS — optional: `backend`, `frontend`, or empty for both. Append a path/keyword to filter, e.g. `backend test_projects` or `frontend api-client`

**Backend tests (pytest)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
python -m pytest tests/ -v --tb=short $FILTER 2>&1 | tail -60
```

**Frontend tests (vitest)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npx vitest run $FILTER 2>&1 | tail -60
```

Steps:
1. If no argument or both: run backend first, then frontend
2. Parse $ARGUMENTS to extract the suite (backend/frontend) and optional filter keyword
3. Show a summary at the end:
   - Number of tests passed / failed / skipped
   - Any failing test names with short error
   - Total time

If backend tests fail due to missing DB connection, suggest:
```bash
docker compose up -d core-postgres core-redis
```

If the argument includes a file path or test name keyword, pass it as a pytest `-k` filter or vitest `--reporter=verbose` with name filter.

Common useful invocations:
- `/test` → runs everything
- `/test backend` → only pytest
- `/test frontend` → only vitest
- `/test backend test_projects` → pytest filtered to projects tests
