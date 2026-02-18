Run Alembic database migrations for the TestForge backend.

Arguments: $ARGUMENTS — optional command: `upgrade` (default), `downgrade`, `history`, `current`, or `revision "message"`

Available sub-commands:
- (no arg or `upgrade`) → apply all pending migrations: `alembic upgrade head`
- `downgrade` → roll back one migration: `alembic downgrade -1`
- `history` → show migration history
- `current` → show current revision
- `revision "message"` → auto-generate a new migration with the given message

Steps:
1. Navigate to the backend directory and check the current state:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend && alembic current 2>&1
```

2. Execute the requested command:
```bash
# For upgrade (default):
cd /Users/jluizgomes/Documents/Projetos/testforge/backend && alembic upgrade head

# For downgrade:
cd /Users/jluizgomes/Documents/Projetos/testforge/backend && alembic downgrade -1

# For history:
cd /Users/jluizgomes/Documents/Projetos/testforge/backend && alembic history --verbose

# For new revision:
cd /Users/jluizgomes/Documents/Projetos/testforge/backend && alembic revision --autogenerate -m "$ARGUMENTS"
```

3. Show the result clearly — which migrations were applied (or rolled back), current revision after the operation.

4. If the DATABASE_URL is not set, remind the user to set it:
```bash
export DATABASE_URL=postgresql+asyncpg://testforge:testforge@localhost:5432/testforge
```

Important: Always show the list of applied/pending migrations before destructive operations like downgrade.
