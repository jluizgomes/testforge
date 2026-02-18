Create a new TestForge project via the API with interactive setup.

Arguments: $ARGUMENTS — optional project name (will prompt for details if not provided)

1. If no name provided, ask the user for:
   - Project name
   - Project path (directory containing tests)
   - Description (optional)
   - Frontend URL (optional)
   - Backend URL (optional)

2. Create the project:
```bash
curl -s -X POST http://localhost:8000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"{name}\",
    \"path\": \"{path}\",
    \"description\": \"{description}\",
    \"config\": {
      \"frontend_url\": \"{frontend_url}\",
      \"backend_url\": \"{backend_url}\"
    }
  }" | python3 -m json.tool
```

3. Show the created project details and its generated ID.

4. Offer next steps:
   - "Scan for tests: `/scan {project_name}`"
   - "Run existing tests: `/run-tests {project_name}`"
   - "Configure more settings in the Projects page"

5. Validate the path exists before creating:
```bash
ls "{path}" 2>/dev/null | head -5 || echo "WARNING: Path does not exist or is not accessible"
```

If a project with that name already exists, warn the user and show the existing project details.

Quick example usage:
- `/new-project` → interactive mode
- `/new-project my-app` → creates with name "my-app", prompts for path
