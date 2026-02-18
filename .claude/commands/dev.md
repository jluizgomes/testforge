Start the TestForge development environment (frontend + backend).

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, or empty for both

Show which processes are already running:
```bash
lsof -i :8000 | grep LISTEN | head -3
lsof -i :5173 | grep LISTEN | head -3
```

Based on what's running and the argument:

**Backend** (FastAPI on :8000):
```bash
# Check if virtual env exists
ls /Users/jluizgomes/Documents/Projetos/testforge/backend/.venv/bin/activate 2>/dev/null || echo "NO_VENV"

# Start backend
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate && uvicorn app.main:app --reload --port 8000 --host 0.0.0.0
```

**Frontend** (Vite on :5173):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npm run dev
```

**Both** (suggest using two terminal tabs):
- Print the commands for the user to run in separate terminals
- Do NOT run both in the same process as they'd conflict

Requirements checklist before starting:
- PostgreSQL running? `pg_isready -h localhost -p 5432`
- Redis running? `redis-cli ping`
- .env file exists? `ls backend/.env`

If any dependency is missing, show a clear warning with the start command for that service.

Useful URLs once running:
- Frontend:  http://localhost:5173
- API docs:  http://localhost:8000/docs
- Health:    http://localhost:8000/health
