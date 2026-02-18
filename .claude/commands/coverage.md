Run tests with coverage report for frontend (vitest) and/or backend (pytest-cov).

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, or empty for both. Append a module path to focus, e.g. `backend app/api`.

**Backend (pytest + coverage)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
python -m pytest tests/ --cov=app --cov-report=term-missing --cov-report=html:htmlcov -q 2>&1 | tail -40
```

**Frontend (vitest + v8 coverage)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npx vitest run --coverage 2>&1 | tail -40
```

**Summarise the coverage report**:

```
Backend Coverage:
  app/api/v1/projects.py     94%  ████████████░░
  app/api/v1/test_runs.py    87%  ██████████░░░░
  app/core/engine.py         61%  ███████░░░░░░░  ← low
  app/reports/generator.py   45%  █████░░░░░░░░░  ← critical
  ─────────────────────────────
  TOTAL                      78%

Frontend Coverage:
  src/services/api-client.ts   92%
  src/stores/app-store.ts      89%
  src/lib/utils.ts             100%
  ─────────────────────────────
  TOTAL                        71%
```

Flag any module below 60% as "needs attention" and suggest:
- Which functions are uncovered (from the `term-missing` output)
- The test file that should cover it (based on the existing test structure in `backend/tests/`)

HTML reports are saved to:
- Backend: `backend/htmlcov/index.html` → `open backend/htmlcov/index.html`
- Frontend: `coverage/index.html` → `open coverage/index.html`
