Run static type checking — TypeScript (tsc --noEmit) for frontend, mypy for backend.

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, or empty for both.

**Frontend (TypeScript)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npx tsc --noEmit 2>&1
```

**Backend (mypy)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
python -m mypy app/ --ignore-missing-imports 2>&1
```

**Summarise results**:
- Total errors found per tool
- Group errors by file
- For TS: highlight the most common error codes (TS2322 = type mismatch, TS2339 = property missing, TS17004 = JSX error, etc.)
- For mypy: highlight `[assignment]`, `[arg-type]`, `[return-value]` patterns

Show output like:
```
TypeScript: 0 errors ✓

mypy: 3 errors
  app/core/engine.py:82  [assignment]  Incompatible types...
  app/schemas/project.py:45  [arg-type]  ...
```

If errors found, for each error explain:
1. What the error means in plain language
2. The likely fix

If mypy is not installed: `pip install mypy`

Always run this before creating a PR to catch type regressions early.
