Run a code quality analysis on the latest test run for a project, with optional AI failure analysis.

Arguments: $ARGUMENTS — project name/ID, optionally with `--ai` flag to enable AI analysis, e.g. `myproject --ai`

1. Parse arguments: extract project identifier and whether `--ai` flag is present
2. Find the project ID and its latest completed run
3. Request quality analysis:

```bash
# Without AI:
curl -s -X POST "http://localhost:8000/api/v1/reports/quality" \
  -H "Content-Type: application/json" \
  -d "{\"run_id\": \"{run_id}\", \"include_ai_analysis\": false}" | python3 -m json.tool

# With --ai flag:
curl -s -X POST "http://localhost:8000/api/v1/reports/quality" \
  -H "Content-Type: application/json" \
  -d "{\"run_id\": \"{run_id}\", \"include_ai_analysis\": true}" | python3 -m json.tool
```

4. Display results:
```
Quality Score: 87  Grade: B

Insights:
  [ERROR]   3 tests timed out (>10s)
  [WARNING] 5 tests have no error messages
  [INFO]    2 duplicate test names found

Error Patterns:
  TimeoutError    3 occurrences
  AssertionError  8 occurrences

AI Analysis (if enabled):
  Test: "login flow" — Root cause: selector changed, fix: update to data-testid
  ...
```

5. Give actionable next steps based on the grade:
   - A: "Great quality! Consider adding more edge cases."
   - B-C: "See warnings above. Run `/ai-analyze {run_id}` for detailed fixes."
   - D-F: "Critical issues found. Run `/ai-analyze {run_id}` immediately."

Note: AI analysis may take 30-60s per failure. Use `--ai` only when needed.
