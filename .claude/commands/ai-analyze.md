Analyze a test failure using the TestForge AI agent and get actionable fix suggestions.

Arguments: $ARGUMENTS — run ID, or a direct error message/stack trace to analyze

1. If argument looks like a run ID (UUID or 8-char prefix), fetch the failed results first:
```bash
# Find project for this run
curl -s http://localhost:8000/api/v1/projects | python3 -c "import sys,json; [print(p['id']) for p in json.load(sys.stdin)]"

# For each project, look for the run
curl -s http://localhost:8000/api/v1/projects/{project_id}/runs/{run_id}/results | python3 -c "
import sys, json
results = json.load(sys.stdin)
failed = [r for r in results if r['status'] == 'failed']
for r in failed[:3]:
    print(f\"Test: {r['test_name']}\")
    print(f\"Error: {r.get('error_message', 'no error')[:200]}\")
    print('---')
"
```

2. Send failure details to the AI analyze endpoint:
```bash
curl -s -X POST http://localhost:8000/api/v1/ai/analyze \
  -H "Content-Type: application/json" \
  -d "{
    \"test_name\": \"{test_name}\",
    \"error_message\": \"{error_message}\",
    \"test_code\": \"{test_code}\"
  }" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('Root Cause:', r.get('root_cause', 'Unknown'))
print()
print('Suggestions:')
for s in r.get('suggestions', []):
    print(f'  • {s}')
print()
print('Fixed Code:')
print(r.get('fixed_code', 'No fix available'))
"
```

3. If argument is a plain error message/stack trace (not a run ID), send it directly as the error_message.

4. Present the analysis clearly with:
   - Root cause explanation
   - Step-by-step fix suggestions
   - Fixed code snippet if available
   - Confidence level

If multiple failures exist in a run, analyze the top 3 and summarize patterns.
