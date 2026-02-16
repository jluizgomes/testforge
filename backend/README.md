# TestForge AI Backend

Python backend for TestForge AI - Intelligent E2E Testing Platform.

## Features

- FastAPI REST API
- SQLAlchemy 2.0 with async support
- Playwright test runner
- OpenTelemetry tracing
- LangGraph AI agents
- ChromaDB RAG pipeline

## Development

```bash
# Install dependencies
uv pip install -e ".[dev]"

# Run server
uvicorn app.main:app --reload --port 8000
```
