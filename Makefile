# TestForge AI - Makefile
# Intelligent E2E Testing Platform

.PHONY: help install install-frontend install-backend install-playwright \
        dev dev-frontend dev-backend dev-electron \
        build build-frontend build-backend build-electron \
        test test-frontend test-backend test-e2e \
        lint lint-frontend lint-backend format format-backend \
        db-create db-migrate db-upgrade db-downgrade db-reset \
        clean clean-frontend clean-backend clean-all \
        docker-up docker-down docker-logs \
        check health

# Colors for terminal output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Project paths
ROOT_DIR := $(shell pwd)
BACKEND_DIR := $(ROOT_DIR)/backend
FRONTEND_DIR := $(ROOT_DIR)
VENV := $(BACKEND_DIR)/.venv
PYTHON := $(VENV)/bin/python
UV := uv
NPM := npm

# Default ports
BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 5173

# Default target
.DEFAULT_GOAL := help

##@ General

help: ## Display this help message
	@echo "$(BLUE)TestForge AI$(NC) - Intelligent E2E Testing Platform"
	@echo ""
	@echo "$(YELLOW)Usage:$(NC)"
	@echo "  make $(GREEN)<target>$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf ""} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(YELLOW)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Installation

install: install-frontend install-backend install-playwright ## Install all dependencies
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

install-frontend: ## Install frontend (npm) dependencies
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) install
	@echo "$(GREEN)✓ Frontend dependencies installed$(NC)"

install-backend: ## Install backend (Python) dependencies
	@echo "$(BLUE)Installing backend dependencies...$(NC)"
	cd $(BACKEND_DIR) && $(UV) pip install -e ".[dev]"
	@echo "$(GREEN)✓ Backend dependencies installed$(NC)"

install-playwright: ## Install Playwright browsers
	@echo "$(BLUE)Installing Playwright browsers...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/playwright install chromium
	@echo "$(GREEN)✓ Playwright browsers installed$(NC)"

install-playwright-all: ## Install all Playwright browsers (chromium, firefox, webkit)
	@echo "$(BLUE)Installing all Playwright browsers...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/playwright install
	@echo "$(GREEN)✓ All Playwright browsers installed$(NC)"

##@ Development

dev: ## Run both frontend and backend in development mode (requires tmux or run in separate terminals)
	@echo "$(YELLOW)Starting development servers...$(NC)"
	@echo "$(BLUE)Run these commands in separate terminals:$(NC)"
	@echo "  make dev-backend"
	@echo "  make dev-frontend"
	@echo ""
	@echo "Or use: make dev-tmux (requires tmux)"

dev-tmux: ## Run both frontend and backend in tmux session
	@command -v tmux >/dev/null 2>&1 || { echo "$(RED)tmux is required but not installed$(NC)"; exit 1; }
	@tmux new-session -d -s testforge 'make dev-backend' \; \
		split-window -h 'make dev-frontend' \; \
		attach

dev-frontend: ## Run frontend development server (Vite)
	@echo "$(BLUE)Starting frontend development server on port $(FRONTEND_PORT)...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run dev

dev-backend: ## Run backend development server (FastAPI)
	@echo "$(BLUE)Starting backend development server on port $(BACKEND_PORT)...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/uvicorn app.main:app --reload --port $(BACKEND_PORT)

dev-electron: ## Run Electron app in development mode
	@echo "$(BLUE)Starting Electron development mode...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run electron:dev

##@ Build

build: build-frontend build-backend ## Build both frontend and backend
	@echo "$(GREEN)✓ Build complete$(NC)"

build-frontend: ## Build frontend for production
	@echo "$(BLUE)Building frontend...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run build
	@echo "$(GREEN)✓ Frontend build complete$(NC)"

build-backend: ## Build backend package
	@echo "$(BLUE)Building backend...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/python -m build
	@echo "$(GREEN)✓ Backend build complete$(NC)"

build-electron: ## Build Electron app for distribution
	@echo "$(BLUE)Building Electron app...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run electron:build
	@echo "$(GREEN)✓ Electron build complete$(NC)"

build-electron-linux: ## Build Electron app for Linux
	@echo "$(BLUE)Building Electron app for Linux...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run electron:build -- --linux
	@echo "$(GREEN)✓ Linux build complete$(NC)"

build-electron-win: ## Build Electron app for Windows
	@echo "$(BLUE)Building Electron app for Windows...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run electron:build -- --win
	@echo "$(GREEN)✓ Windows build complete$(NC)"

build-electron-mac: ## Build Electron app for macOS
	@echo "$(BLUE)Building Electron app for macOS...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run electron:build -- --mac
	@echo "$(GREEN)✓ macOS build complete$(NC)"

##@ Testing

test: test-backend test-frontend ## Run all tests
	@echo "$(GREEN)✓ All tests complete$(NC)"

test-frontend: ## Run frontend tests (Vitest)
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run test

test-frontend-watch: ## Run frontend tests in watch mode
	@echo "$(BLUE)Running frontend tests in watch mode...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run test:watch

test-backend: ## Run backend tests (pytest)
	@echo "$(BLUE)Running backend tests...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/pytest

test-backend-cov: ## Run backend tests with coverage
	@echo "$(BLUE)Running backend tests with coverage...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/pytest --cov=app --cov-report=html --cov-report=term-missing

test-e2e: ## Run E2E tests (Playwright)
	@echo "$(BLUE)Running E2E tests...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/pytest tests/e2e -v

##@ Code Quality

lint: lint-frontend lint-backend ## Run all linters
	@echo "$(GREEN)✓ Linting complete$(NC)"

lint-frontend: ## Lint frontend code (ESLint)
	@echo "$(BLUE)Linting frontend...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run lint

lint-backend: ## Lint backend code (Ruff)
	@echo "$(BLUE)Linting backend...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/ruff check app

format: format-frontend format-backend ## Format all code
	@echo "$(GREEN)✓ Formatting complete$(NC)"

format-frontend: ## Format frontend code (Prettier)
	@echo "$(BLUE)Formatting frontend...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run format 2>/dev/null || $(NPM) exec prettier -- --write "src/**/*.{ts,tsx,css}"

format-backend: ## Format backend code (Black + Ruff)
	@echo "$(BLUE)Formatting backend...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/ruff check --fix app
	cd $(BACKEND_DIR) && $(VENV)/bin/black app

typecheck: typecheck-frontend typecheck-backend ## Run type checking
	@echo "$(GREEN)✓ Type checking complete$(NC)"

typecheck-frontend: ## Type check frontend (TypeScript)
	@echo "$(BLUE)Type checking frontend...$(NC)"
	cd $(FRONTEND_DIR) && $(NPM) run typecheck 2>/dev/null || $(NPM) exec tsc -- --noEmit

typecheck-backend: ## Type check backend (mypy)
	@echo "$(BLUE)Type checking backend...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/mypy app

##@ Database

db-create: ## Create the database (requires PostgreSQL running)
	@echo "$(BLUE)Creating database...$(NC)"
	docker exec core-postgres psql -U postgres -c "CREATE DATABASE testforge;" 2>/dev/null || echo "$(YELLOW)Database may already exist$(NC)"
	@echo "$(GREEN)✓ Database ready$(NC)"

db-migrate: ## Create a new migration (usage: make db-migrate MSG="migration message")
	@echo "$(BLUE)Creating migration...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic revision --autogenerate -m "$(MSG)"
	@echo "$(GREEN)✓ Migration created$(NC)"

db-upgrade: ## Apply all pending migrations
	@echo "$(BLUE)Applying migrations...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic upgrade head
	@echo "$(GREEN)✓ Migrations applied$(NC)"

db-downgrade: ## Rollback last migration
	@echo "$(BLUE)Rolling back last migration...$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic downgrade -1
	@echo "$(GREEN)✓ Rollback complete$(NC)"

db-reset: ## Reset database (drop all tables and re-apply migrations)
	@echo "$(RED)Resetting database...$(NC)"
	docker exec core-postgres psql -U postgres -c "DROP DATABASE IF EXISTS testforge;"
	docker exec core-postgres psql -U postgres -c "CREATE DATABASE testforge;"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic upgrade head
	@echo "$(GREEN)✓ Database reset complete$(NC)"

db-shell: ## Open PostgreSQL shell
	@echo "$(BLUE)Opening database shell...$(NC)"
	docker exec -it core-postgres psql -U postgres -d testforge

db-status: ## Show current migration status
	@echo "$(BLUE)Migration status:$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic current

db-history: ## Show migration history
	@echo "$(BLUE)Migration history:$(NC)"
	cd $(BACKEND_DIR) && $(VENV)/bin/alembic history

##@ Docker (Infrastructure)

docker-up: ## Start infrastructure services (PostgreSQL, Redis, Jaeger)
	@echo "$(BLUE)Starting infrastructure services...$(NC)"
	cd ~/Documents/Projetos/infra-core && docker-compose up -d
	@echo "$(GREEN)✓ Infrastructure services started$(NC)"

docker-down: ## Stop infrastructure services
	@echo "$(BLUE)Stopping infrastructure services...$(NC)"
	cd ~/Documents/Projetos/infra-core && docker-compose down
	@echo "$(GREEN)✓ Infrastructure services stopped$(NC)"

docker-logs: ## Show infrastructure service logs
	cd ~/Documents/Projetos/infra-core && docker-compose logs -f

docker-ps: ## Show running containers
	docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

##@ Utilities

check: ## Check project dependencies and status
	@echo "$(BLUE)Checking project status...$(NC)"
	@echo ""
	@echo "$(YELLOW)Node.js:$(NC)"
	@node --version 2>/dev/null || echo "  $(RED)✗ Node.js not found$(NC)"
	@echo ""
	@echo "$(YELLOW)Python:$(NC)"
	@$(PYTHON) --version 2>/dev/null || echo "  $(RED)✗ Python venv not found$(NC)"
	@echo ""
	@echo "$(YELLOW)Docker containers:$(NC)"
	@docker ps --format "  {{.Names}}: {{.Status}}" 2>/dev/null || echo "  $(RED)✗ Docker not running$(NC)"
	@echo ""
	@echo "$(YELLOW)Database:$(NC)"
	@docker exec core-postgres psql -U postgres -d testforge -c "SELECT 1;" >/dev/null 2>&1 && echo "  $(GREEN)✓ PostgreSQL connected$(NC)" || echo "  $(RED)✗ PostgreSQL not available$(NC)"

health: ## Check backend health endpoint
	@echo "$(BLUE)Checking backend health...$(NC)"
	@curl -s http://localhost:$(BACKEND_PORT)/health 2>/dev/null && echo "" || echo "$(RED)Backend not responding on port $(BACKEND_PORT)$(NC)"

api-docs: ## Open API documentation in browser
	@echo "$(BLUE)Opening API documentation...$(NC)"
	@xdg-open http://localhost:$(BACKEND_PORT)/docs 2>/dev/null || open http://localhost:$(BACKEND_PORT)/docs 2>/dev/null || echo "Open http://localhost:$(BACKEND_PORT)/docs in your browser"

##@ Cleanup

clean: clean-frontend clean-backend ## Clean build artifacts
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

clean-frontend: ## Clean frontend build artifacts
	@echo "$(BLUE)Cleaning frontend...$(NC)"
	rm -rf $(FRONTEND_DIR)/dist
	rm -rf $(FRONTEND_DIR)/dist-electron
	rm -rf $(FRONTEND_DIR)/.vite

clean-backend: ## Clean backend build artifacts
	@echo "$(BLUE)Cleaning backend...$(NC)"
	rm -rf $(BACKEND_DIR)/dist
	rm -rf $(BACKEND_DIR)/build
	rm -rf $(BACKEND_DIR)/*.egg-info
	find $(BACKEND_DIR) -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find $(BACKEND_DIR) -type f -name "*.pyc" -delete 2>/dev/null || true

clean-all: clean ## Clean everything including dependencies
	@echo "$(BLUE)Cleaning all dependencies...$(NC)"
	rm -rf $(FRONTEND_DIR)/node_modules
	rm -rf $(BACKEND_DIR)/.venv
	@echo "$(GREEN)✓ Full cleanup complete$(NC)"

##@ AI & RAG

chroma-reset: ## Reset ChromaDB vector store
	@echo "$(BLUE)Resetting ChromaDB...$(NC)"
	rm -rf $(BACKEND_DIR)/data/chroma
	@echo "$(GREEN)✓ ChromaDB reset$(NC)"

ollama-pull: ## Pull default Ollama models
	@echo "$(BLUE)Pulling Ollama models...$(NC)"
	ollama pull llama3.1:8b
	ollama pull codellama:7b
	@echo "$(GREEN)✓ Ollama models ready$(NC)"

ollama-list: ## List installed Ollama models
	@echo "$(BLUE)Installed Ollama models:$(NC)"
	ollama list

##@ Quick Start

setup: docker-up install db-create db-upgrade ## Complete project setup (first time)
	@echo ""
	@echo "$(GREEN)════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)  TestForge AI setup complete!$(NC)"
	@echo "$(GREEN)════════════════════════════════════════════════════════════$(NC)"
	@echo ""
	@echo "$(YELLOW)To start development:$(NC)"
	@echo "  Terminal 1: make dev-backend"
	@echo "  Terminal 2: make dev-frontend"
	@echo ""
	@echo "$(YELLOW)Or for Electron:$(NC)"
	@echo "  make dev-electron"
	@echo ""
	@echo "$(YELLOW)API Documentation:$(NC)"
	@echo "  http://localhost:$(BACKEND_PORT)/docs"
	@echo ""

quickstart: setup dev-tmux ## Setup and start development (requires tmux)
