Show backend logs or inspect a specific test run's error details.

Arguments: $ARGUMENTS — optional: `run {run_id}` to inspect a run, or empty to show recent backend activity

**Show backend process logs** (if running via uvicorn in background):
```bash
# Find the uvicorn process
pgrep -f "uvicorn app.main" | head -3

# If running in docker:
docker compose logs --tail=50 backend 2>/dev/null || echo "Not running in Docker"
```

**Inspect a specific run** (`/logs run abc123`):
1. Find project for the run, then fetch full run details:
```bash
curl -s "http://localhost:8000/api/v1/projects/{project_id}/runs/{run_id}" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(f\"Run ID:    {r['id']}\")
print(f\"Status:    {r['status']}\")
print(f\"Error:     {r.get('error_message', 'none')}\")
print(f\"Duration:  {r.get('duration_ms', '-')}ms\")
print()
"
```

2. Fetch individual test results:
```bash
curl -s "http://localhost:8000/api/v1/projects/{project_id}/runs/{run_id}/results" | python3 -c "
import sys, json
results = json.load(sys.stdin)
for r in results:
    status_icon = '✓' if r['status'] == 'passed' else '✗' if r['status'] == 'failed' else '○'
    print(f\"{status_icon} {r['test_name']} ({r.get('duration_ms', '-')}ms)\")
    if r['status'] == 'failed' and r.get('error_message'):
        for line in r['error_message'][:300].split('\n'):
            print(f\"  {line}\")
"
```

**Show recent API errors** (from health endpoint):
```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

Always end with: "Use `/ai-analyze {run_id}` to get AI-powered fix suggestions for failures."
