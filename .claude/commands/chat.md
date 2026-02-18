Chat with the TestForge AI assistant about testing, failures, or best practices.

Arguments: $ARGUMENTS — your message or question to the AI

This command sends a single message to the TestForge AI chat endpoint and returns the response.

```bash
curl -s -X POST http://localhost:8000/api/v1/ai/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"$ARGUMENTS\",
    \"history\": []
  }" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(r.get('response', r.get('message', str(r))))
"
```

Display the AI response directly.

If the AI is unavailable (Ollama not running or misconfigured):
- Show the error message
- Suggest checking settings: `curl -s http://localhost:8000/api/v1/settings | python3 -m json.tool`
- Remind the user to start Ollama: `ollama serve`

Good questions to ask:
- `/chat How do I test a React login form with Playwright?`
- `/chat Why is my test failing with "element not found"?`
- `/chat What are best practices for API testing with pytest?`
- `/chat How do I test file uploads in my FastAPI app?`

For multi-turn conversation, use the full AI Assistant page in the TestForge UI at http://localhost:5173.
