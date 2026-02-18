Start a test run for a TestForge project via the API.

Arguments: $ARGUMENTS (optional project name or ID to run. If empty, list available projects first)

Steps:
1. If no argument provided, list available projects first:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "import sys,json; projects=json.load(sys.stdin); [print(f'  {p[\"id\"][:8]}  {p[\"name\"]}  ({p[\"path\"]})') for p in projects]" 2>/dev/null || echo "Could not list projects"
```

2. If argument provided, find the project by name or ID prefix:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "
import sys, json
arg = '$ARGUMENTS'.strip()
projects = json.load(sys.stdin)
match = next((p for p in projects if arg.lower() in p['name'].lower() or p['id'].startswith(arg)), None)
if match:
    print(match['id'])
else:
    print('NOT_FOUND')
" 2>/dev/null
```

3. Once you have the project ID, start the run:
```bash
curl -s -X POST http://localhost:8000/api/v1/projects/{project_id}/runs \
  -H "Content-Type: application/json" \
  -d '{"config": null}' | python3 -m json.tool
```

4. Show the run ID and initial status, and tell the user they can track it in the Test Runner page or use `/tail-run {run_id}`.

Handle errors gracefully (project not found, backend offline, etc.).
