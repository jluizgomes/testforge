Run linters on the TestForge codebase — ESLint for frontend, Ruff for backend.

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, or empty for both. Append `--fix` to auto-fix.

**Frontend (ESLint + TypeScript)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0 2>&1
```

With `--fix`:
```bash
npx eslint . --ext ts,tsx --fix 2>&1
```

**Backend (Ruff)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
ruff check app/ tests/ 2>&1
```

With `--fix`:
```bash
ruff check app/ tests/ --fix 2>&1
```

**Parse and summarise the output**:
- Count errors vs warnings per file
- Group by rule code (e.g. `react-hooks/exhaustive-deps`, `E501`, `B008`)
- Show the top 5 most violated rules
- If `--fix` was used, report how many issues were auto-fixed vs remaining

If ruff is not installed: `pip install ruff`
If eslint errors relate to unused imports, suggest running with `--fix`.

Output format:
```
Frontend: 3 errors, 12 warnings
  src/features/projects/... (2 errors)
  ...

Backend: 0 errors ✓

Top violations:
  react-hooks/exhaustive-deps  ×8
  @typescript-eslint/no-explicit-any  ×4
```
