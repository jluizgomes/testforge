Poll and display the live status of a test run until it completes.

Arguments: $ARGUMENTS — run ID (full UUID or first 8 chars) and optionally project ID, e.g. `abc123 proj456`

Parse $ARGUMENTS:
- First token = run_id (or run_id prefix)
- Second token (optional) = project_id (or project_id prefix)

If project_id not provided, find it by searching all projects for this run:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -c "import sys,json; [print(p['id']) for p in json.load(sys.stdin)]"
```

Then poll the run status every 3 seconds up to 10 times (use a loop):
```bash
for i in $(seq 1 10); do
  STATUS=$(curl -s http://localhost:8000/api/v1/projects/{project_id}/runs/{run_id})
  echo "$STATUS" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(f\"Status: {r['status']} | {r['passed_tests']}/{r['total_tests']} passed | {r['failed_tests']} failed\")
if r['status'] in ('passed', 'failed', 'cancelled'):
    sys.exit(1)
"
  [ $? -eq 1 ] && break
  sleep 3
done
```

When complete, show a summary:
- Final status (passed/failed)
- Total / Passed / Failed / Skipped counts
- Duration
- Any error_message if failed

If the run_id argument is missing, list the 5 most recent runs across all projects.
