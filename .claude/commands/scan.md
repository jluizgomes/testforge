Trigger an AI-powered project scan to generate test suggestions.

Arguments: $ARGUMENTS — project name or ID prefix (required)

1. Find the project:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "
import sys, json
arg = '$ARGUMENTS'.strip()
projects = json.load(sys.stdin)
match = next((p for p in projects if arg.lower() in p['name'].lower() or p['id'].startswith(arg)), None)
if match:
    print(f\"{match['id']}|{match['name']}|{match['path']}\")
else:
    print('NOT_FOUND')
"
```

2. Start the scan:
```bash
curl -s -X POST http://localhost:8000/api/v1/scan \
  -H "Content-Type: application/json" \
  -d "{\"project_id\": \"{project_id}\", \"project_path\": \"{project_path}\"}" | python3 -m json.tool
```

3. Poll the scan status using the returned job_id until status is `completed` or `failed` (poll every 2s, max 30 times):
```bash
curl -s http://localhost:8000/api/v1/scan/status/{job_id} | python3 -m json.tool
```

4. When complete, fetch and display the scan stats:
```bash
curl -s http://localhost:8000/api/v1/scan/stats/{project_id} | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f\"Resources found: {s.get('total_resources', 0)}\")
print(f\"Tests generated: {s.get('total_tests', 0)}\")
by_type = s.get('tests_by_type', {})
for k, v in by_type.items():
    print(f\"  {k}: {v} tests\")
"
```

5. Tell the user they can review suggestions in the project's Tests tab or use `/accept-tests {project_id}`.

If no argument provided, list all projects first.
