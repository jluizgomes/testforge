Display a detailed statistics summary for all projects or a specific one.

Arguments: $ARGUMENTS — optional project name/ID to filter. If empty, show all projects.

1. Fetch all projects:
```bash
curl -s http://localhost:8000/api/v1/projects | python3 -m json.tool
```

2. For each project (or the specified one), fetch its runs and compute:
```bash
curl -s "http://localhost:8000/api/v1/projects/{project_id}/runs" | python3 -c "
import sys, json
runs = json.load(sys.stdin)
total = len(runs)
completed = [r for r in runs if r['status'] in ('passed', 'failed')]
passed_runs = sum(1 for r in completed if r['status'] == 'passed')
total_tests = sum(r['total_tests'] for r in completed)
total_passed = sum(r['passed_tests'] for r in completed)
avg_dur = sum(r['duration_ms'] or 0 for r in completed) // max(len(completed), 1)
pass_rate = round(total_passed / total_tests * 100, 1) if total_tests > 0 else 0
last = runs[0] if runs else None
print(f'Total runs:     {total}')
print(f'Pass rate:      {pass_rate}%')
print(f'Avg duration:   {avg_dur}ms')
print(f'Last run:       {last[\"status\"] if last else \"never\"} ({last[\"created_at\"][:10] if last else \"-\"})')
print(f'Total tests:    {total_tests}')
"
```

3. Format output as a clear table or per-project sections:

```
Project: my-app
  Path:         /Users/dev/my-app
  Total runs:   42
  Pass rate:    94.3%
  Total tests:  1,204
  Avg duration: 12,300ms
  Last run:     passed (2026-02-19)
```

4. At the bottom, show aggregate totals across all projects.

5. If $ARGUMENTS specifies a project, also show the last 5 individual run statuses as a mini history.
