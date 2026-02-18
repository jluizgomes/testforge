Generate and download a test report for a project's latest (or specified) run.

Arguments: $ARGUMENTS — project name/ID and optionally format: `myproject html` or `myproject junit` or just `myproject`

Supported formats: `html` (default), `pdf`, `junit`, `json`, `markdown`, `allure`

1. Parse arguments — first token = project identifier, second token (optional) = format
2. Find the project ID by name/prefix
3. Get the latest run for the project:
```bash
curl -s "http://localhost:8000/api/v1/projects/{project_id}/runs?limit=1" | python3 -c "
import sys, json
runs = json.load(sys.stdin)
if runs:
    r = runs[0]
    print(f\"{r['id']}|{r['status']}|{r['passed_tests']}/{r['total_tests']}|{r['created_at']}\")
else:
    print('NO_RUNS')
"
```

4. Generate the report:
```bash
curl -s -X POST http://localhost:8000/api/v1/reports/generate \
  -H "Content-Type: application/json" \
  -d "{\"run_id\": \"{run_id}\", \"format\": \"{format}\"}" \
  --output /tmp/testforge-report.{format}
```

5. Display the report path and summary:
   - For `json` format: pretty-print key stats inline
   - For `markdown` format: show the content directly
   - For `html`/`pdf`/`junit`/`allure`: show file path and open command

6. Offer to open the file:
   - macOS: `open /tmp/testforge-report.{format}`
   - Linux: `xdg-open /tmp/testforge-report.{format}`

If no runs exist for the project, tell the user to run tests first with `/run-tests {project}`.
