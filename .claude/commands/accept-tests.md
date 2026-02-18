Accept all pending AI-generated test suggestions for a project and export them as a ZIP.

Arguments: $ARGUMENTS — project name or ID prefix (required)

1. Find the project:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "
import sys, json
arg = '$ARGUMENTS'.strip()
projects = json.load(sys.stdin)
match = next((p for p in projects if arg.lower() in p['name'].lower() or p['id'].startswith(arg)), None)
if match:
    print(f\"{match['id']}|{match['name']}\")
else:
    print('NOT_FOUND')
"
```

2. List pending (not yet accepted) generated tests:
```bash
curl -s "http://localhost:8000/api/v1/scan/generated-tests/{project_id}" | python3 -c "
import sys, json
tests = json.load(sys.stdin)
pending = [t for t in tests if not t['accepted']]
accepted = [t for t in tests if t['accepted']]
print(f'Pending: {len(pending)}  Already accepted: {len(accepted)}')
for t in pending:
    print(f\"  [{t['id'][:8]}] {t['test_name']} ({t['test_type']})\")
"
```

3. Confirm with the user before bulk-accepting (show count).

4. Accept all pending tests:
```bash
# For each pending test ID:
curl -s -X PATCH "http://localhost:8000/api/v1/scan/generated-tests/{test_id}" \
  -H "Content-Type: application/json" \
  -d '{"accepted": true}'
```

5. Export the accepted tests as a ZIP:
```bash
curl -s "http://localhost:8000/api/v1/scan/export/{project_id}" \
  --output /tmp/testforge-tests-{project_id_short}.zip
echo "Exported to /tmp/testforge-tests-{project_id_short}.zip"
```

6. Show the final count and the ZIP location.

If no tests exist, suggest running `/scan {project}` first.
