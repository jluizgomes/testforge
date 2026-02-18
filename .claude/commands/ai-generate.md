Generate tests using the TestForge AI agent for a specific context or file.

Arguments: $ARGUMENTS — description of what to test, e.g. "login form validation" or a file path like "src/auth/login.ts"

1. Determine context from argument:
   - If it looks like a file path, read that file to use as context
   - Otherwise use the argument as the feature description

2. Call the AI generate endpoint:
```bash
curl -s -X POST http://localhost:8000/api/v1/ai/generate \
  -H "Content-Type: application/json" \
  -d "{
    \"context\": \"$ARGUMENTS\",
    \"test_type\": \"e2e\",
    \"framework\": \"playwright\"
  }" | python3 -m json.tool
```

3. Display the generated test code in a formatted code block with the correct language.

4. Ask the user if they want to:
   a) Save it to a file (ask for the target path)
   b) Try a different test type (unit, integration, api)
   c) Refine it with a follow-up prompt

If the AI is unavailable (Ollama not running), show the error and suggest checking settings at http://localhost:8000/api/v1/settings.

Tips:
- For Playwright tests, the generated code will be TypeScript
- For API/backend tests, it will be Python/pytest
- Use `/ai-analyze` to analyze existing test failures instead
