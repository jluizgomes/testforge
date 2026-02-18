Format the TestForge codebase — Prettier for frontend, Black + Ruff for backend.

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, or empty for both. Default runs formatters (writes changes). Pass `--check` to only verify without writing.

**Frontend (Prettier)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge

# Format (default):
npx prettier --write "src/**/*.{ts,tsx,css}" "electron/**/*.ts" 2>&1

# Check only:
npx prettier --check "src/**/*.{ts,tsx,css}" "electron/**/*.ts" 2>&1
```

**Backend (Black + Ruff isort)**:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true

# Format (default):
black app/ tests/ 2>&1
ruff check app/ tests/ --select I --fix 2>&1   # fix import order

# Check only:
black app/ tests/ --check 2>&1
```

**Show summary**:
- How many files were reformatted (or would be)
- Any files that couldn't be formatted (parse errors)

If `--check` mode finds issues, suggest running `/format` without the flag.

Tip: Run `/lint` after formatting to confirm no new lint violations were introduced.
