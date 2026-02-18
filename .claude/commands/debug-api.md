Inspect and debug a TestForge API endpoint interactively — make requests, inspect responses, trace errors.

Arguments: $ARGUMENTS — endpoint path and optionally method + payload, e.g. `GET /projects` or `POST /projects/abc123/runs` or just `/projects`

**Parse $ARGUMENTS**:
- Extract HTTP method (default: GET)
- Extract path (prepend `http://localhost:8000/api/v1` if not full URL)
- Extract JSON payload if provided

**Make the request with verbose output**:
```bash
curl -sv -X {METHOD} \
  "http://localhost:8000/api/v1{PATH}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  {-d '{PAYLOAD}' if POST/PATCH} \
  2>&1 | python3 -c "
import sys, json
raw = sys.stdin.read()
# Extract response body (after empty line in headers)
lines = raw.split('\n')
try:
    body_start = next(i for i, l in enumerate(lines) if l.strip() == '' and i > 5)
    body = '\n'.join(lines[body_start:]).strip()
    parsed = json.loads(body)
    print(json.dumps(parsed, indent=2))
except:
    print(raw[-2000:])
"
```

**Also check**:
1. Response time: compare with `/health` baseline
2. If 4xx/5xx: look for matching route in the router files and show the handler code
3. If 422 Validation Error: explain each missing/invalid field from the `detail` array
4. If 500: suggest checking backend logs (`/logs`)

**Show the OpenAPI schema for this endpoint**:
```bash
curl -s "http://localhost:8000/openapi.json" | python3 -c "
import sys, json
schema = json.load(sys.stdin)
path = '/api/v1{PATH}'
if path in schema.get('paths', {}):
    print(json.dumps(schema['paths'][path], indent=2))
else:
    print('Path not found in OpenAPI schema')
" 2>&1
```

**Interactive mode**: if no argument provided, list all available endpoints from the OpenAPI spec and let the user choose.

```bash
curl -s http://localhost:8000/openapi.json | python3 -c "
import sys, json
schema = json.load(sys.stdin)
for path, methods in schema['paths'].items():
    for method in methods:
        print(f'{method.upper():8} {path}')
" | sort 2>&1
```
