Seed the TestForge database with realistic demo data for development and testing.

Arguments: $ARGUMENTS — optional: `--reset` to clear existing data first, `--minimal` for just 1 project, or empty for full demo dataset.

**Requires the API to be running** — check first:
```bash
curl -sf http://localhost:8000/health > /dev/null || echo "API not running. Start it with: cd backend && uvicorn app.main:app --reload"
```

**If `--reset` flag**, call `/db-reset` logic first (without --seed to avoid recursion).

**Create demo projects**:
```bash
# Project 1: Frontend React app
curl -s -X POST http://localhost:8000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo E-Commerce Frontend",
    "path": "/tmp/demo-frontend",
    "description": "React + TypeScript storefront with Playwright tests",
    "config": {
      "frontend_url": "http://localhost:3000",
      "backend_url": "http://localhost:8001",
      "test_timeout": 30000,
      "parallel_workers": 2,
      "browser": "chromium"
    }
  }' | python3 -c "import sys,json; p=json.load(sys.stdin); print(p['id'])"

# Project 2: FastAPI backend
curl -s -X POST http://localhost:8000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo REST API",
    "path": "/tmp/demo-api",
    "description": "FastAPI backend with pytest integration tests",
    "config": {
      "backend_url": "http://localhost:8001",
      "openapi_url": "http://localhost:8001/openapi.json",
      "database_url": "postgresql://demo:demo@localhost:5432/demo",
      "retry_count": 1
    }
  }' | python3 -c "import sys,json; p=json.load(sys.stdin); print(p['id'])"
```

**Create demo test runs** (simulated results via PATCH on runs):
For each project, create 5 historical runs with varying pass rates to populate the sparkline chart and dashboard stats.

**Verify seeded data**:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "
import sys, json
projects = json.load(sys.stdin)
print(f'Projects created: {len(projects)}')
for p in projects:
    print(f'  {p[\"name\"]} ({p[\"id\"][:8]})')
"
```

Show final summary of what was created:
- X projects
- X test runs (simulated)
- Suggested next step: open http://localhost:5173 to see the data

Note: Demo paths (`/tmp/demo-*`) don't need to exist on disk since runs are simulated.
