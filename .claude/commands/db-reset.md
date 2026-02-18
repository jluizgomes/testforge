Reset the TestForge development database — drop all tables and reapply all migrations from scratch.

Arguments: $ARGUMENTS — optional: `--seed` to also load demo data after reset.

⚠️ **DESTRUCTIVE ACTION**: This deletes all data. Only use in development.

**Confirm before executing** — ask the user: "This will delete all data in the testforge database. Are you sure? (yes/no)"

Only proceed if the user confirms.

**Steps**:

1. Check current DB state:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
alembic current 2>&1
```

2. Drop all tables:
```bash
# Via alembic downgrade:
alembic downgrade base 2>&1

# Or via psql if downgrade fails:
PGPASSWORD=testforge psql -h localhost -U testforge -d testforge -c "
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO testforge;
" 2>&1
```

3. Reapply all migrations:
```bash
alembic upgrade head 2>&1
```

4. Verify:
```bash
alembic current 2>&1
PGPASSWORD=testforge psql -h localhost -U testforge -d testforge -c "\dt" 2>&1
```

5. If `--seed` flag present, load demo data:
- Create 2 demo projects via `POST /api/v1/projects`
- Ensure the API is running first

**Show final table list after reset** to confirm success.

If the database server is not reachable:
- Local: `brew services start postgresql@16` (macOS)
- Docker: `docker compose up -d core-postgres`
