Check the health of the TestForge backend API and all connected services.

Run the following bash command and format the output clearly:

```bash
curl -s http://localhost:8000/health | python3 -m json.tool 2>/dev/null || echo "Backend is not running or unreachable at http://localhost:8000"
```

Then also check if the backend process is running:
```bash
lsof -i :8000 | head -5
```

Present results as:
- Overall API status (online/offline)
- Database: status + latency
- Redis: status + latency
- Any errors or warnings found

If the backend is down, suggest running: `cd backend && uvicorn app.main:app --reload --port 8000`
