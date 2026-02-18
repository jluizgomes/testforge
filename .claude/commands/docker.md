Manage TestForge Docker Compose services for local development and CI.

Arguments: $ARGUMENTS — sub-command: `up`, `down`, `logs`, `rebuild`, `status`, or empty for status.

**Services defined in `docker-compose.yml`**:
- `core-postgres` — PostgreSQL 16 on :5432
- `core-redis` — Redis 7 on :6379
- `backend` — FastAPI app (built from `backend/Dockerfile`)

**Status** (default when no args):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
docker compose ps 2>&1
docker compose images 2>&1
```

**Start services** (`up`):
```bash
# Start only DB + Redis (backend runs locally via uvicorn in dev):
docker compose up -d core-postgres core-redis 2>&1

# Start all services including backend:
docker compose up -d 2>&1
```

**Stop services** (`down`):
```bash
docker compose down 2>&1
# With volumes (deletes DB data):
docker compose down -v 2>&1
```

**View logs** (`logs`):
```bash
# All services:
docker compose logs --tail=50 -f 2>&1

# Specific service:
docker compose logs --tail=100 {service} 2>&1
```

**Rebuild backend image** (`rebuild`):
```bash
docker compose build --no-cache backend 2>&1
docker compose up -d backend 2>&1
```

**Run backend tests in Docker** (same as CI):
```bash
docker compose run --rm --no-deps backend pytest tests/ -v 2>&1
```

**Quick health check after startup**:
```bash
sleep 2
docker compose exec core-postgres pg_isready -U testforge 2>&1
docker compose exec core-redis redis-cli ping 2>&1
```

Always show container status after any `up`/`down` operation.
