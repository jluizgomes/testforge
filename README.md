# TestForge AI

**Intelligent E2E Testing Platform** - AI-powered test generation, execution, and analysis.

## Overview

TestForge AI is a comprehensive testing platform that combines:
- **Frontend**: Electron + React + TypeScript with a modern UI
- **Backend**: FastAPI + Python with async support
- **AI**: LangGraph + RAG (ChromaDB) + OpenAI/Ollama for intelligent test generation
- **Testing**: Playwright for E2E, pytest for API, OpenTelemetry for tracing

## Features

- **Multi-Layer Testing**: Frontend (Playwright), Backend (API), Database, Infrastructure
- **AI-Powered Test Generation**: Generate tests from natural language descriptions
- **Failure Analysis**: AI-assisted root cause analysis with fix suggestions
- **Distributed Tracing**: OpenTelemetry integration for cross-layer visibility
- **RAG-Enhanced Context**: Codebase indexing for context-aware AI responses
- **Comprehensive Reports**: HTML, PDF, JSON, JUnit XML, and Markdown exports
- **Modern UI**: Dark/light theme, real-time test execution, trace visualization

## Prerequisites

- Node.js 18+
- Miniconda/Anaconda (Python env via conda only)
- PostgreSQL 16+
- Redis (optional)
- Ollama (optional, for local AI)

## Quick Start

### 1. Clone and Setup

```bash
cd testforge

# Create conda env (run once)
conda create -n testforge-env python=3.12
conda activate testforge-env

# Install all dependencies (Makefile uses conda run -n testforge-env)
make install
```

### 2. Configure Environment

```bash
# Backend configuration
cp backend/.env.example backend/.env
# Edit backend/.env with your settings
```

### 3. Start PostgreSQL (Docker)

```bash
docker run -d --name testforge-db \
  -e POSTGRES_USER=testforge \
  -e POSTGRES_PASSWORD=testforge \
  -e POSTGRES_DB=testforge \
  -p 5432:5432 \
  postgres:16
```

### 4. Initialize Database

```bash
make db-upgrade
```

### 5. Start Development

```bash
# Terminal 1: Start backend
make dev-backend

# Terminal 2: Start frontend (Electron)
make dev-electron
```

## Project Structure

```
testforge/
├── package.json              # Frontend dependencies
├── electron/                 # Electron main process
│   ├── main.ts              # Main entry point
│   ├── preload.ts           # IPC bridge
│   └── backend-manager.ts   # Backend process management
├── src/                      # React frontend
│   ├── components/          # UI components
│   ├── features/            # Feature modules
│   ├── stores/              # Zustand stores
│   └── services/            # API client
├── backend/                  # Python backend
│   ├── app/
│   │   ├── api/v1/          # REST endpoints
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   ├── core/
│   │   │   ├── runners/     # Test runners
│   │   │   └── tracing/     # OpenTelemetry
│   │   ├── ai/
│   │   │   ├── agents/      # LangGraph agents
│   │   │   └── rag/         # RAG pipeline
│   │   └── reports/         # Report generation
│   └── alembic/             # Database migrations
```

## API Endpoints

### Projects
- `GET /api/v1/projects` - List projects
- `POST /api/v1/projects` - Create project
- `GET /api/v1/projects/{id}` - Get project
- `PATCH /api/v1/projects/{id}` - Update project
- `DELETE /api/v1/projects/{id}` - Delete project

### Test Runs
- `GET /api/v1/projects/{id}/runs` - List test runs
- `POST /api/v1/projects/{id}/runs` - Start test run
- `GET /api/v1/projects/{id}/runs/{run_id}` - Get test run
- `POST /api/v1/projects/{id}/runs/{run_id}/stop` - Stop test run

### AI
- `POST /api/v1/ai/generate` - Generate tests
- `POST /api/v1/ai/analyze` - Analyze failure
- `POST /api/v1/ai/chat` - Chat with assistant

### Traces
- `GET /api/v1/traces` - List traces
- `GET /api/v1/traces/{id}` - Get trace

### Reports
- `POST /api/v1/reports/generate` - Generate report

## Configuration

### Environment Variables

```bash
# Application
APP_NAME=TestForge AI
DEBUG=false
ENVIRONMENT=development

# Database
DATABASE_URL=postgresql+asyncpg://testforge:testforge@localhost:5432/testforge

# AI Providers
OPENAI_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_AI_PROVIDER=openai
DEFAULT_AI_MODEL=gpt-4

# Tracing
ENABLE_TRACING=true
JAEGER_ENDPOINT=localhost:6831
```

## Test Runners

### Frontend Runner (Playwright)
```python
from app.core.runners import FrontendRunner, RunnerConfig

runner = FrontendRunner(RunnerConfig(
    headless=True,
    browser="chromium",
    viewport_width=1280,
    viewport_height=720,
))
```

### Backend Runner (API)
```python
from app.core.runners import BackendRunner, RunnerConfig

runner = BackendRunner(RunnerConfig(
    base_url="http://localhost:8000",
    timeout_ms=30000,
))
```

### Database Runner
```python
from app.core.runners import DatabaseRunner, RunnerConfig

runner = DatabaseRunner(RunnerConfig(
    database_url="postgresql://...",
))
```

## AI Integration

### Test Generation
```python
from app.ai.agents import TestGeneratorAgent

agent = TestGeneratorAgent()
result = await agent.generate(
    prompt="Generate login tests",
    project_id="...",
    test_type="e2e",
)
```

### Failure Analysis
```python
from app.ai.agents import FailureAnalyzerAgent

agent = FailureAnalyzerAgent()
analysis = await agent.analyze(
    error_message="Element not found",
    error_stack="...",
    test_name="login_test",
    test_file="tests/login.spec.ts",
    project_id="...",
)
```

## Building for Production

### Build Frontend
```bash
npm run build:frontend
```

### Package Electron App
```bash
npm run electron:build
```

### Build Backend (PyInstaller)
```bash
cd backend
pyinstaller --onefile -n testforge-backend app/main.py
```

## Development

### Run Tests
```bash
make test-frontend
make test-backend
```

### Code Quality
```bash
make lint
make format
make typecheck
```

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request
